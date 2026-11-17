# Scene engine validation

| Check | Result |
| --- | --- |
| Original application before changes | Frontend build passed. Ten frontend and eighteen backend tests passed. Preview and four guidance passes exported from the original road scene. |
| Updated application | Production build passed. Eighteen frontend and eighteen backend tests passed. |
| Six independent kit examples | All compiled through Ajv and the actual orchestrator. Native v3 JSON round-tripped through the editor's runtime schema. |
| Courtyard movement | Recast steered the walker around a solid wall and wrote editable timeline keys. |
| Physics determinism | Rapier generated identical keys on repeated builds. The sampled sphere fell, contacted the platform and bounced. |
| Unknown asset and invalid JSON | Fictional objects kept their IDs and roles as visible proxies. Invalid geometry, circular spatial references and unknown properties were rejected. |
| Browser end-to-end | Chromium and FastAPI imported the acoustic-vault scene, loaded the human and lantern, played the timeline, previewed both shots, and switched between independent stages. Object position, a track key and a camera position were edited in the UI. Save, reload and project ZIP reimport succeeded. Stage GLB downloaded with a valid glTF header. |
| Additional browser checks | Both remaining catalog GLBs loaded through the editor, the bench prefab was generated, stage save/add/replace/duplicate worked, a camera reference was captured, and the video workspace and original room editor opened. |
| Original road regression | Preview, clay, depth, normal and pose MP4s all encoded at 288 × 512, 12 fps, with 6 frames each for the 0.5-second test trim. All decoded frame hashes matched the frozen release for the five original road exports. |
| Acoustic vault exports | 3 preview MP4s and 12 guidance MP4s, covering both shots and a stitched version. FFprobe reports 26 and 23 shot frames and 49 stitched frames at 288 × 512 and 12 fps with the existing per-shot frame rounding. |
| Master prompt verification | The acoustic-vault scene was prepared using the finished prompt and manifests. It was run through the actual browser import and export. A separate ChatGPT session was outside the test. |
| Windows launcher | Reused with the pinned requirements and bundled frontend. The server and browser checks ran on Linux. Native Windows launch needs verification on a Windows machine. |

See [the imported scene](acoustic-vault.scene.json), [the editor screenshot](acoustic-vault.jpg) and [the video probe records](ffprobe.json).
