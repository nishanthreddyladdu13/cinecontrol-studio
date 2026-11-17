# CineControl Studio

## Scene generation from ChatGPT JSON

Run `run-studio.cmd` and open [the local editor](http://127.0.0.1:8000/). In **Script**, select **Observatory example** or download the **ChatGPT scene generator kit**. Paste the resulting scene JSON into Script and choose **Build scene from JSON**. The builder uses local models, procedural geometry, and editable paths and shots. The ChatGPT JSON workflow works without configuring an API key.

See [Scene Engine and Windows setup](docs/SCENE_ENGINE.md) for details and [the master prompt](frontend/public/scene-kit/MASTER_SCENE_JSON_GENERATOR_PROMPT.md) for the JSON workflow.

A local React, Three.js and FastAPI editor for microdrama staging, blocking, cameras and AI-video reference preparation. The built-in street demo has five shots across an 18-second timeline, including a car passing a ground-level camera.

## Open on Windows

Install Python 3.12 with the Windows Python launcher. Extract the whole ZIP. Double-click **run-studio.cmd** in the cinecontrol-studio folder. The launcher installs Python dependencies on the first run. Open http://127.0.0.1:8000 and leave the command window open.

For a manual Command Prompt launch, open CMD in the extracted cinecontrol-studio folder.

```bat
cd backend
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The build is included in frontend/dist. A Python 3.12 install is enough to launch the packaged editor. Node.js 22.12+ is only needed when rebuilding from TypeScript. If updating an older installation, export a project backup first, stop its server, then launch from the newly extracted folder. Use the same browser profile and http://127.0.0.1:8000 to reach the earlier browser-local save.

For live script generation, fill in the existing backend/.env settings and restart.

```dotenv
LLM_PROVIDER=gemini
LLM_MODEL=your_available_gemini_model_id
LLM_API_KEY=your_gemini_api_key
```

Use a Gemini model that supports structured outputs and is available to your API account. Keep the credential in the local backend environment. The backend uses a system FFmpeg when present and the FFmpeg executable included in the pinned imageio-ffmpeg wheel otherwise. Verify discovery from backend after installing dependencies.

```bat
.venv\Scripts\python.exe -c "from app.previs import find_ffmpeg; print(find_ffmpeg())"
```

If you already have a working FFmpeg binary elsewhere, set CINECONTROL_FFMPEG in backend/.env to its full executable path. Verify the encoder in Export after restarting the server.

## Demonstrate the street scene

1. Open **Script** to import a TXT, a v3 project JSON or a legacy 0.1 street JSON, generate a full or component-specific draft, or reload the street sample.
2. In **Stage**, pick **Main road** and edit its X dimension. Move an object in the world view or inspector.
3. Open **Blocking** and select **Sedan**. Change one time or position keyframe. The blue path and the camera preview show the change on the shared timeline.
4. Open **Cameras** and choose **03 Frog-eye pass**. The default camera is 0.15 m above the road. Scrub around 8.5 s to see the pass.
5. In **Export**, choose the desired shot and check Clay, Depth, Normal and Pose. Choose Export Guidance MP4s or Export PNG Sequences. Export Preview MP4 uses the regular rendered scene. For all shots, choose separate files, a stitched sequence, or both. Full per-shot exports appear automatically in Video Generation. PNG sequences and the metadata retain the original samples for data-sensitive uses.
6. In **References**, capture or upload appearance images. In **Video Generation**, prepare a manual handoff and import an externally generated clip for comparison.
7. **Save** keeps the editable project in the browser. Use **Export → Project JSON** for a portable scene backup. Use Export Project Bundle for a portable ZIP containing attached assets and reference metadata. Open that ZIP through Script. Clear the bulky-media checkbox for a lighter bundle. The Stage GLB is a static snapshot.

The original room editor remains available via **Help → Open original room editor**, or http://127.0.0.1:8000/room.html. See docs/ORIGINAL_ROOM_EDITOR.md for its original scope and API.

## Development and verification

```text
cd backend
python -m unittest discover -s tests -v
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal, run npm ci then npm run dev from frontend. Vite proxies /api to the local backend.

```text
cd frontend
npm test
npm run build
```

The new workspace is under frontend/src/previs. Backend schema and optional FFmpeg encoding are in backend/app/previs.py. The v2 room API and tests are retained. See docs/CineControl_Design.md for the implementation plan and acceptance checklist.

## Current boundaries

- Manual image and video generation require no configured provider key in CineControl. Paid integrations are optional. Set STABILITY_API_KEY to enable structure-guided cinematic images. Set ARK_API_KEY to enable Seedance tasks within ModelArk. Add these entries to backend/.env and restart. The app requires explicit authorization before submitting a paid request.
- Seedance Omni accepts general reference videos and appearance images. Start/end frame mode is separate. In API mode, reference videos need provider-reachable HTTPS URLs or approved asset IDs. The app keeps local files available for manual packages. Depth, normal and proxy pose are experimental references for Seedance. Live model output and the comparative quality of these reference combinations have not been tested.
- Stage switching selects an independent shot sequence. A stitched export combines shots from the active stage. Bundled rigged models can play their verified clips. Personal GLB imports retain track transforms, and the studio has no arbitrary rig retargeting.
- The live Generate scene button requires a configured API account. The backend path is tested with a simulated model response. ChatGPT JSON import runs locally.
- A software rendering fallback supports previews and guidance when a browser disables WebGL. GPU and software passes use the documented encoding but can differ in shading and antialiasing.
- Pose exports use 18 projected proxy joints with approximate visibility. The live collision badge uses object bounds. Scene JSON can bake selected rigid-body motions through Rapier.
- Quick Save is browser-local. Use a portable ZIP to share or reopen a project elsewhere. A bundle supports up to 280 MB of attached assets.
