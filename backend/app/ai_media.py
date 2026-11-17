"""Explicit paid image and video requests for the local studio."""
import os
import re
from typing import Annotated, Literal
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Path, Request, Response
from pydantic import BaseModel, Field, model_validator

router = APIRouter(prefix="/api/previs")
ARK = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks"
TaskId = Annotated[str, Path(pattern=r"^[a-zA-Z0-9_-]{1,100}$")]
MODEL = "dreamina-seedance-2-5-260628"
IMAGE = "https://api.stability.ai/v2beta/stable-image/control/structure"


class VideoAsset(BaseModel):
    kind: Literal["image_url","video_url"]
    role: Literal["first_frame","last_frame","reference_image","reference_video"]
    url: str = Field(max_length=24_000_000)


class SeedanceRequest(BaseModel):
    mode: Literal["omni","frames","text"]
    prompt: str = Field(min_length=1,max_length=16000)
    duration: int = Field(ge=4,le=30)
    ratio: Literal["adaptive","9:16","16:9","1:1","4:3","3:4","21:9"]
    resolution: Literal["480p","720p","1080p"]
    generate_audio: bool = False
    assets: list[VideoAsset] = Field(max_length=40)
    confirm_charge: Literal[True]

    @model_validator(mode="after")
    def valid_mode(self):
        roles=[asset.role for asset in self.assets]
        if self.mode=="text" and roles:
            raise ValueError("Text mode has no attachments.")
        if self.mode=="frames" and (roles not in [["first_frame"],["first_frame","last_frame"]] or self.ratio!="adaptive"):
            raise ValueError("Use first frame and optional last frame with adaptive ratio.")
        if self.mode=="omni" and (not roles or any(r not in {"reference_image","reference_video"} for r in roles)):
            raise ValueError("Omni mode requires reference images or reference videos.")
        if roles.count("reference_video")>10 or roles.count("reference_image")>30:
            raise ValueError("Exceeded Seedance attachment count.")
        byte_length=0
        for asset in self.assets:
            byte_length+=len(asset.url)
            if asset.kind=="video_url":
                if asset.role!="reference_video" or not re.match(r"^(https://[^\s]+|asset://[\w-]+)$",asset.url):
                    raise ValueError("Video assets require a public HTTPS URL or a ModelArk asset ID.")
            elif asset.role=="reference_video" or not re.match(r"^(data:image/(png|jpeg|webp);base64,|https://|asset://)",asset.url):
                raise ValueError("An image needs a compatible data URI, HTTPS URL, or an asset ID.")
        if byte_length>48_000_000:
            raise ValueError("Total inlined references are too large for this request.")
        return self


def ark_headers():
    key=os.getenv("ARK_API_KEY")
    if not key:
        raise HTTPException(503,"Add ARK_API_KEY to backend/.env, then restart.")
    return {"Authorization":"Bearer "+key}


def seedance_payload(req: SeedanceRequest):
    return {"model":os.getenv("ARK_SEEDANCE_MODEL",MODEL),"duration":req.duration,"ratio":req.ratio,
            "resolution":req.resolution,"generate_audio":req.generate_audio,
            "content":[{"type":"text","text":req.prompt}]+[
                {"type":asset.kind,"role":asset.role,asset.kind:{"url":asset.url}} for asset in req.assets
            ]}


async def ark_task(task_id: str):
    headers = ark_headers()
    async with httpx.AsyncClient(timeout=30) as client:
        result=await client.get(ARK+"/"+task_id,headers=headers)
        result.raise_for_status()
        return result.json()


@router.post("/seedance")
async def seedance(req: SeedanceRequest):
    headers = ark_headers()
    try:
        async with httpx.AsyncClient(timeout=50) as client:
            result=await client.post(ARK,headers=headers,json=seedance_payload(req))
            result.raise_for_status()
            return {"id":result.json()["id"]}
    except (httpx.HTTPError,ValueError,KeyError) as exc:
        raise HTTPException(502,"ModelArk rejected the request or could not be reached. Check the selected model, account access, credits and media input.") from exc


@router.get("/seedance/{task_id}")
async def seedance_status(task_id: TaskId):
    try:
        task=await ark_task(task_id)
        return {"status":task.get("status","unknown")}
    except (httpx.HTTPError,ValueError,KeyError) as exc:
        raise HTTPException(502,"Could not get the ModelArk task.") from exc


@router.get("/seedance/{task_id}/video")
async def seedance_video(task_id: TaskId):
    try:
        task=await ark_task(task_id)
        url=(task.get("content") or {}).get("video_url","")
        parsed=urlsplit(url)
        domain=parsed.hostname or ""
        trusted=domain.endswith((".volces.com",".bytepluses.com",".byteplus.com",".volccdn.com"))
        if task.get("status")!="succeeded" or parsed.scheme!="https" or not trusted:
            raise HTTPException(409,"Returned video is unavailable or its CDN origin is outside the built-in allowlist.")
        async with httpx.AsyncClient(timeout=70,follow_redirects=False) as client:
            async with client.stream("GET",url) as video:
                video.raise_for_status()
                content=bytearray()
                async for chunk in video.aiter_bytes():
                    content.extend(chunk)
                    if len(content)>150*1024*1024:
                        raise HTTPException(413,"The video exceeds the local import limit.")
        if content[4:8]!=b"ftyp":
            raise HTTPException(502,"The provider response was not an MP4.")
        return Response(bytes(content),media_type="video/mp4")
    except (httpx.HTTPError,ValueError,KeyError) as exc:
        raise HTTPException(502,"Could not retrieve the rendered clip.") from exc


class ImageRequest(BaseModel):
    prompt: str = Field(min_length=1,max_length=8500)
    confirm_charge: Literal[True]
    image: str = Field(max_length=13_500_000)


@router.post("/cinematic-image")
async def cinematic_image(req: ImageRequest):
    import base64
    from binascii import Error as DecodeError
    key=os.getenv("STABILITY_API_KEY")
    if not key:
        raise HTTPException(503,"Add STABILITY_API_KEY to backend/.env, then restart.")
    header,_,encoded=req.image.partition(",")
    if header not in {"data:image/png;base64","data:image/jpeg;base64","data:image/webp;base64"}:
        raise HTTPException(422,"Choose a PNG, JPEG or WebP camera frame.")
    mime=header.removeprefix("data:").removesuffix(";base64")
    try:
        image=base64.b64decode(encoded,validate=True)
    except DecodeError as exc:
        raise HTTPException(422,"Invalid image data.") from exc
    try:
        async with httpx.AsyncClient(timeout=100) as client:
            result=await client.post(IMAGE,headers={"Authorization":"Bearer "+key,"Accept":"image/*"},
                 files={"image":("camera."+mime.split("/")[-1],image,mime)},
                 data={"prompt":req.prompt,"control_strength":"0.7","output_format":"png"})
            result.raise_for_status()
        if not result.content.startswith(b"\x89PNG"):
            raise HTTPException(502,"Stability did not return a PNG.")
        return Response(result.content,media_type="image/png")
    except httpx.HTTPError as exc:
        raise HTTPException(502,"Stability rejected the request or could not be reached. Check your image, account and credits.") from exc
