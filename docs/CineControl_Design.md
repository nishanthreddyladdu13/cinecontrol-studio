# CineControl · Interactive previs editor

## A. Application architecture

The script workspace submits text to FastAPI. Gemini returns structured scene data. FastAPI validates it and the user can edit the draft before opening the editor. JSON imports and the street sample open locally.

React owns the project data and edit history. One Three.js scene evaluates all movement at the playhead time. The world camera supports editing and the selected shot camera drives preview and export. Stage, blocking, cameras and shots have independent records. A new camera angle uses the same blocking clock, so it cannot reset object movement. The browser exports guidance. Users create final clips externally and import them for comparison.

## B. Desktop wireframe

| Area | Content |
|---|---|
| Top toolbar | Project title, Script, Stage, Blocking, Cameras, References, Export, Video, Undo, Redo, Save |
| Left sidebar | Stage hierarchy, moving subjects, shots, visibility and lock controls |
| Center left | World View with orbit, pan, zoom, view presets, transform tools, paths and camera markers |
| Center right | Live 9:16 camera viewport with pass selector and frame capture |
| Right sidebar | Object transform, selected path point, or camera and shot settings |
| Bottom | Playhead, transport, shot strips and individual actor/prop tracks with keyframe markers |

Script, References, Export and Video open focused panels. The selected shot and playhead remain available when the user goes back to editing.

## C. User interaction

| Control | Immediate effect | Data and save behavior |
|---|---|---|
| Script, TXT and Generate Scene | See a draft list of objects, tracks and shots | Send script to FastAPI. Approve the draft to apply it. |
| JSON import and Street sample | Replace the editor contents with the selected scene | Validate before replacing. Undo restores the prior state. |
| Hierarchy and viewport picking | Select and highlight the same item in both places | Selection stays in the current session. |
| Add, duplicate, delete, visibility and lock | Update hierarchy and geometry | Commit to history. Deleting a stage object removes its track. |
| Transform tools and inspector | Move, rotate or resize the selected entity | Commit on gesture completion or inspector edit. Lock prevents transforms. |
| Grid, view preset and camera split | Change the view and framing aids | Keep project coordinates intact. |
| Blocking key and timing | Change the world path and the timeline marker | Write a keyframe by object ID and time. |
| Shots and cameras | Change the active camera, shot duration, order or source interval | Write a shot record linking the camera and blocking time. |
| Play, step, speed and loop | Move all preview panels together | Keep transport state in the session. |
| Capture and upload | Attach an opening or ending frame or appearance image | Store media locally by project and shot ID. |
| Pass export | Sample selected camera and passes at matching frame times | Show progress, then download ZIP with frame and scene metadata. |
| Video review | Export a provider handoff and play an imported final clip | Store it locally with the shot and approval status. |
| Save, Undo/Redo | Persist or restore the project and current edits | Save locally, with a downloadable JSON backup. |

## D. Components and reuse

- Preserve the existing React/FastAPI room editor, sample scenes and v2 endpoint. Reuse the Windows launch scripts, React, Three.js, Vite build and existing provider transport.
- Add an editor workspace. The project module handles schemas and the blocking clock. The viewport module builds geometry, renders cameras and passes, and supports selection and transforms. The React workspace owns panels, history and timeline interaction.
- Add a versioned FastAPI previs endpoint and keep model credentials server-side. The script draft is project data and can be reviewed before opening.
- Use the legacy exporter as a reference for depth encoding, proxy pose projection and camera metadata. Give ordinary props explicit position tracks so cars can actually pass the camera.

## E. Data structure

A project binds independent stages, object tracks, cameras and shots. This abbreviated example shows the links.

    {
      "version": 3,
      "id": "street-demo",
      "stage": { "bounds": [18, 12, 64], "objects": [{ "id": "car", "position": [1.8, 0, -26] }] },
      "tracks": [{ "objectId": "car", "action": "drive", "keys": [
        { "time": 0, "position": [1.8, 0, -26] },
        { "time": 12, "position": [1.8, 0, 30] }
      ] }],
      "cameras": [{ "id": "frog", "position": [1.8, 0.15, 3.7], "target": [3.7, 0.65, -8] }],
      "shots": [{ "id": "pass", "cameraId": "frog", "start": 6, "duration": 4 }],
      "fps": 24
    }

Positions are bottom-center metres with +Y up. Keyframes use the blocking clock and shots select intervals from it. Exports carry both shot-local and blocking times. The complete schema also includes object visibility, FOV, roll and optional camera keyframes.

## F. Priorities

| Priority | Features |
|---|---|
| MVP | Script draft and JSON import, street sample, object editing, continuous blocking, camera shots, split viewport, playback, guidance export, save and reopen |
| Demo | Frog-eye pass, reference capture, imported MP4 review, manual provider handoff, GLB import/export, collision hints and shortcuts |
| Future | Full collision simulation, mocap retargeting, collaborative versions, server render jobs and final-video automation |

## G. Implementation order

1. Keep the room editor and its tests available. Add a versioned project model.
2. Render world and shot views. Connect picking, gizmos and the inspector.
3. Implement the shared blocking clock, per-shot intervals and camera cuts.
4. Connect script generation to the existing FastAPI provider. Keep offline sample and JSON routes.
5. Implement synchronized pass exports, project persistence, references and external clip review.
6. Check car movement at the frog-eye cut and deliver Windows setup instructions.

## H. Acceptance checklist

- Open the street demo. Edit the road width and move a tree. Confirm both views update.
- Move the jogger's path point. Verify the timeline and preview use the new position.
- Verify the frog-eye camera is 0.15 m above the road and inspect the car passing over it.
- Step across a cut and check the jogger and car have continuous positions.
- Export all four passes, then compare frame counts, dimensions, timestamps and camera records.
- Save, reload and reopen a downloaded JSON backup.
- Generate a new scene with configured provider credentials. Verify a clear error when credentials are unavailable.
- Attach an opening frame and an external MP4, reload, and verify the media and approval state.
