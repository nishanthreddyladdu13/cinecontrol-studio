# CineControl Studio update

## Fixes

- **Export.** The original MP4 action encoded clay and failed if the encoder was absent from the backend PATH. The updated backend discovers a system FFmpeg or uses the FFmpeg executable from imageio-ffmpeg. The Export tab separates regular 3D preview MP4s, clay/depth/normal/pose MP4s, PNG sequences, and project files. Guidance video packages can keep shots separate, stitch them, or include both.
- **References.** Opening, ending and playhead camera captures have their own slots. Captures record camera and scene state and show a refresh prompt when the shot changes. The opening image in the reported screenshot occupied the old upload slot. Older images are kept as unapproved visual inputs. Cinematic images, reusable character sheets, and environment/style references have separate approval and prompt workflows.
- **Generation.** The selected shot collects saved guide videos and approved images. Seedance Omni, first/last frames and text-only modes have distinct attachment rules. Clay defaults to a camera and movement reference. Depth, normals and proxy pose are individually selectable experimental reference videos in Omni. The manual request contains only enabled inputs. Optional, explicitly authorized API calls use locally configured credentials. The reviewer plays imported takes beside the 3D reference and saves approval state.
- **Timeline.** Keyframe diamonds can be dragged. The inspector edits position, rotation, time and linear/ease/hold interpolation. Drag snapping uses frame times and nearby keyframes. Duration edits change the cut sequence while keeping blocking on its original scene clock.
- **Stages and portability.** Separate stages keep separate shot sequences. Import independent GLB/GLTF models, place them in World View, edit object transforms, group them and reuse them from the asset shelf. Compatible JSON stages merge object definitions. Quick Save stays local; the project ZIP includes script, scene data, timeline, linked assets and companion files, reference approvals and optional large clips. The original room editor is now under Help → Legacy and developer tools.

## Changed files

| Area | Files |
|---|---|
| Studio layout and timeline | frontend/src/previs/Previs.tsx, studio.css, project.ts |
| 3D and assets | frontend/src/previs/viewport.ts, assets.ts |
| Guidance exports and portable saves | frontend/src/previs/export.ts, media.ts, bundle.ts |
| Reference and video workspaces | frontend/src/previs/ReferencePanel.tsx, references.ts, VideoPanel.tsx, seedance.ts |
| FastAPI | backend/app/main.py, previs.py, ai_media.py, backend/.env.example, backend/requirements.txt |
| Start and verify | run-studio.cmd, README.md, frontend/tests/previs.test.ts, backend/tests/test_ai_media.py |

## Verification

- Frontend production build passed. All 10 frontend tests and 18 backend tests passed.
- Browser export of Shot 03 downloaded a ZIP with regular preview and guidance output as separate export actions. The preview and all four guidance videos decoded as H.264, 480 × 854, 24 fps, 96 frames and 4 seconds. The guidance metadata kept 96 shared camera samples and showed a 0.15 m opening camera height.
- Browser export of all five shots downloaded 20 individual guidance videos and four stitched guidance videos. Every video passed metadata validation. Each stitched video decoded at 288 × 512, 24 fps, 432 frames and 18 seconds. The ZIP and probe data are in evidence/studio-update.
- Browser captures of Shot 03 used 6.000 s for the opening frame and 9.958 s for the last frame at 24 fps. The references screenshot shows the captured images.
- The real GLTF loader parsed a two-part tree. An integration test saved and reopened a project ZIP in an empty test IndexedDB instance, then reloaded its GLB hierarchy, modified transforms, second stage, approved visual references, guide and review clip. The smaller bundle excluded the video files. The same test produced and checked a Seedance Omni package that contained a clay video and two approved images.
- FFmpeg fallback discovery was run with PATH lookup disabled on Linux. The Windows x64 wheel was downloaded and its packaged ffmpeg.exe was inspected. The Windows launcher still needs to be run on a Windows machine.
- Browser upload verification was interrupted. The model, portable-bundle and request checks listed above used local synthetic fixtures. Live paid image/video requests and output quality comparisons were not run. The pose video uses proxy joints, and imported character meshes follow object tracks without skeletal retargeting.
