"""Version 3 previs validation, script generation and optional local MP4 encoding."""
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated, Literal
import re
import os
import shutil
import subprocess
from zipfile import BadZipFile, ZipFile

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, ValidationError, model_validator

router = APIRouter(prefix="/api/previs")
Vector = tuple[float, float, float]
Dimension = Annotated[float, Field(ge=.01, le=1000)]
Size = tuple[Dimension, Dimension, Dimension]
Identity = Annotated[str, Field(pattern=r"^[\w-]{1,64}$")]
Name = Annotated[str, Field(min_length=1, max_length=100)]
Time = Annotated[float, Field(ge=0, le=600)]

class StageObject(BaseModel):
    id: Identity
    name: Name
    kind: Literal["road","sidewalk","tree","lamp","building","character","car","box","sphere","table","chair","asset"]
    position: Vector
    size: Size
    rotation: Vector = (0,0,0)
    scale: Size = (1,1,1)
    color: str = Field(default="#6a7277", pattern=r"^#[0-9a-fA-F]{6}$")
    visible: bool = True
    locked: bool = False
    group: str = Field(default="", max_length=80)
    assetId: Identity | None = None
    identityId: Identity | None = None

class Stage(BaseModel):
    bounds: Size
    objects: list[StageObject] = Field(max_length=150)

class ObjectKey(BaseModel):
    time: Time
    position: Vector
    yaw: float | None = None
    rotation: Vector | None = None
    interpolation: Literal["linear","ease","hold"] | None = None
    visible: bool | None = None

class Track(BaseModel):
    objectId: Identity
    action: Literal["hold","walk","jog","turn","sit","drive"]
    keys: list[ObjectKey] = Field(min_length=1, max_length=100)

class CameraKey(BaseModel):
    time: Time
    position: Vector
    target: Vector
    interpolation: Literal["linear","ease","hold"] | None = None

class Camera(BaseModel):
    id: Identity
    name: Name
    position: Vector
    target: Vector
    fov: float = Field(ge=10, le=130)
    roll: float = 0
    actorId: Identity | None = None
    keys: list[CameraKey] = Field(default_factory=list,max_length=100)

class Shot(BaseModel):
    id: Identity
    name: Name
    cameraId: Identity
    start: Time
    duration: float = Field(ge=.1, le=30)
    prompt: str = Field(default="", max_length=4000)

class Project(BaseModel):
    version: Literal[3]
    id: Identity
    title: Name
    script: str = Field(max_length=18000)
    stage: Stage
    tracks: list[Track] = Field(max_length=100)
    cameras: list[Camera] = Field(min_length=1,max_length=40)
    shots: list[Shot] = Field(min_length=1,max_length=40)
    fps: int = Field(ge=12,le=60)

    @model_validator(mode="after")
    def validate_links(self):
        object_ids = {obj.id for obj in self.stage.objects}
        camera_ids = {camera.id for camera in self.cameras}
        track_ids = {track.objectId for track in self.tracks}
        if len(object_ids) != len(self.stage.objects) or len(camera_ids) != len(self.cameras) or len(track_ids) != len(self.tracks) or len({shot.id for shot in self.shots}) != len(self.shots):
            raise ValueError("Duplicate IDs or object tracks.")
        if not track_ids <= object_ids or any(c.actorId and c.actorId not in object_ids for c in self.cameras):
            raise ValueError("A track or camera points to a missing object.")
        if any(shot.cameraId not in camera_ids or shot.start + shot.duration > 600 for shot in self.shots):
            raise ValueError("Invalid camera or shot interval.")
        for owner in [*self.tracks,*self.cameras]:
            if any(a.time >= b.time for a,b in zip(owner.keys,owner.keys[1:])):
                raise ValueError("Keyframes must have increasing time.")
        return self

class DraftRequest(BaseModel):
    script: str = Field(min_length=12,max_length=18000)
    scope: Literal["all","stage","blocking","cameras"] = "all"
    current: Project | None = None

SYSTEM = """You are a previs shot planner. Return the version 3 Project as JSON. Preserve the user's actual setting, actors, props, movement and timing. Use metres and +Y up, with bottom-centre object origins. Bounds/size order: x width, y height, z depth. Rotations are in degrees; zero yaw faces +Z. Stage objects describe only the set and initial placements. Track keys are time, position and optional yaw. Track time is the scene's continuous seconds. For a vehicle passing the camera, give it actual position keys before, during and after the pass. Use one continuous clock with successive shot intervals by default. Specify realistic proxy dimensions, stage context geometry, distinct camera position and target, and shot action prompts. Add realistic camera suggestions matching the script. Use a camera position near the ground for a frog-eye shot. Keep scene data compact. Use valid IDs and omit optional values when they are unused."""

@router.post("/validate")
def validate(project: Project):
    return project.model_dump(exclude_none=True)

@router.post("/draft")
async def draft(req: DraftRequest):
    from .main import invoke
    original = req.current
    request_prompt = req.script
    if req.scope != "all":
        if original is None:
            raise HTTPException(422, "Component generation requires an open project.")
        if req.scope == "stage":
            scope_rule = "Refine stage objects and bounds. Preserve all existing object IDs referenced by tracks or cameras."
        elif req.scope == "blocking":
            scope_rule = "Generate only blocking tracks using the existing object IDs. Respect existing camera and shot settings."
        else:
            scope_rule = "Generate only camera and shot records. Preserve existing stage object IDs and the blocking clock."
        request_prompt += "\n" + scope_rule + "\nCurrent project for context:\n" + original.model_dump_json(exclude_none=True)
    prompt = request_prompt
    for attempt in range(2):
        try:
            result = await invoke(prompt, instructions=SYSTEM, schema=Project.model_json_schema())
            update = Project.model_validate_json(result)
            if req.scope != "all" and original is not None:
                combined = original.model_dump()
                fields = {"stage":["stage"], "blocking":["tracks"], "cameras":["cameras","shots"]}[req.scope]
                for field in fields:
                    combined[field] = getattr(update,field)
                update = Project.model_validate(combined)
            update.script = req.script
            return update.model_dump(exclude_none=True)
        except ValidationError as exc:
            if attempt:
                raise HTTPException(422,"The model response still has invalid scene data after repair.") from exc
            prompt = request_prompt + "\nRepair these validation errors in the scene draft:\n" + str(exc)[:2500]
        except (httpx.HTTPError,KeyError,IndexError,TypeError) as exc:
            raise HTTPException(502,"Scene generation failed. Check provider access, model and quota.") from exc
    raise HTTPException(422,"Could not create a scene draft.")

def find_ffmpeg():
    explicit = os.environ.get("CINECONTROL_FFMPEG")
    if explicit:
        return shutil.which(explicit)
    system = shutil.which("ffmpeg")
    if system:
        return system
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError, OSError):
        return None

@router.get("/capabilities")
def capabilities():
    return {"mp4": bool(find_ffmpeg()), "seedance":bool(os.getenv("ARK_API_KEY")), "image":bool(os.getenv("STABILITY_API_KEY"))}

@router.post("/encode")
async def encode(req: Request, fps: Annotated[int, Field(ge=12,le=60)] = 24, data_pass: bool = False):
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise HTTPException(503,"MP4 encoder unavailable. Install the updated backend requirements and restart CineControl.")
    limit = 150 * 1024 * 1024
    received = bytearray()
    async for chunk in req.stream():
        if len(received) + len(chunk) > limit:
            raise HTTPException(413,"Source frame archive exceeds 150 MiB.")
        received.extend(chunk)
    import asyncio
    return Response(await asyncio.to_thread(encode_frames,bytes(received),fps,ffmpeg,data_pass),media_type="video/mp4")

def encode_frames(payload: bytes, fps: int, ffmpeg: str, data_pass: bool = False):
    try:
        with ZipFile(BytesIO(payload)) as archive, TemporaryDirectory() as temporary:
            entries = sorted(archive.infolist(),key=lambda item:item.filename)
            if not 1 <= len(entries) <= 1800 or sum(entry.file_size for entry in entries) > 190 * 1024 * 1024:
                raise HTTPException(422,"Invalid frame count or uncompressed size.")
            directory = Path(temporary)
            for i, entry in enumerate(entries,1):
                if not re.fullmatch(r"\d{5}\.png",entry.filename) or entry.filename != f"{i:05}.png":
                    raise HTTPException(422,"Frames must be sequential PNGs.")
                frame = archive.read(entry)
                if not frame.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise HTTPException(422,"Invalid PNG data.")
                (directory / entry.filename).write_bytes(frame)
            output = directory / "clay.mp4"
            subprocess.run([ffmpeg,"-nostdin","-hide_banner","-loglevel","error","-framerate",str(fps),"-start_number","1","-i",str(directory / "%05d.png"),"-c:v","libx264","-preset","veryfast","-crf","15" if data_pass else "19","-pix_fmt","yuv420p","-movflags","+faststart",str(output)],check=True,capture_output=True,timeout=110)
            return output.read_bytes()
    except (BadZipFile,subprocess.CalledProcessError,subprocess.TimeoutExpired,RuntimeError,OSError) as exc:
        raise HTTPException(422,"FFmpeg could not encode the supplied PNG frames.") from exc
