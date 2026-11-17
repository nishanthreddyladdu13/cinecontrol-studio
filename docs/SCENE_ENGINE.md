# CineControl Scene Engine

## Windows quick start

1. Extract the entire ZIP to a normal folder.
2. Install 64-bit Python 3.12 with the Windows Python launcher.
3. Run `run-studio.cmd` from the extracted folder. The launcher creates its own Python environment inside `backend` and installs the pinned server requirements. The first installation requires internet access.
4. Keep the command window open and open [CineControl Studio](http://127.0.0.1:8000/) in Edge or Chrome.
5. In **Script**, select **Observatory example** to try it. To build your own scene, download **ChatGPT scene generator kit**, follow the kit instructions, and paste or open the resulting scene JSON.
6. Open **Stage** to edit geometry and load models or prefabs. Use **Blocking**, **Cameras**, and **Export** for guidance. MP4 encoding uses the bundled backend dependency `imageio-ffmpeg` when a system FFmpeg binary is unavailable.

Node is required to rebuild the frontend after source edits. The release includes a prebuilt frontend. To rebuild, use Node 20.19 or Node 22.12 and newer compatible versions, then run `npm ci`, `npm test`, and `npm run build` from `frontend`. Run the same Windows launcher afterward.

## Existing project audit

The source baseline was the prior CineControl Studio Windows Updated release, SHA-256 `493b548c91e3daff6ec05af1d8df9c7a8fd8ff72c4e00e3685151f878eddddb1`. A local Git checkpoint was created before edits with short commit `4cf45d6`. The original frontend build and 10 frontend and 18 backend tests passed before integration. The existing road demo also produced a preview and four guidance MP4s through Chromium and FastAPI.

The application uses React 19.1.1, Three.js 0.180.0, Vite 7.1.12, TypeScript 5.9.3, Zod 3.25.76, and FastAPI 0.141.1. The original room editor is available at `/room.html`. Existing legacy JSON and v3 inputs still use the original importer. The new reader accepts the separate `cinecontrol.scene/1` format, compiles it to the v3 object and timeline model, and uses the same renderer, project storage and export endpoints.

| Integration | Location |
| --- | --- |
| Editable scene import and diagnostics | `frontend/src/previs/Previs.tsx`, `frontend/src/previs/scene/orchestrator.ts` |
| Shape composition and procedural parameters | `scene/generators.ts`, `scene/model.ts`, `scene/render-model.ts` |
| Offline asset selection and loading | `scene/catalog.ts`, `previs/assets.ts`, `previs/viewport.ts`, `frontend/public/models` |
| Validation and geometric placement | `scene/input.ts`, `scene/spatial.ts` |
| Movement, navigation, physics and shot planning | `scene/motion.ts`, `scene/navigation.ts`, `scene/physics.ts`, `scene/cameras.ts` |
| ChatGPT kit and examples | `frontend/public/scene-kit`, `scene/kit.ts` |

## Dependencies and free assets

| Package | Version | License | Use |
| --- | --- | --- | --- |
| Three.js | 0.180.0 | MIT | Existing geometry, renderers, GLTFLoader, SkeletonUtils and AnimationMixer |
| Ajv | 8.17.1 | MIT | Executes the same Draft 07 schema file provided in the kit |
| three-mesh-bvh | 0.9.18 | MIT | Accelerated ray tests on authored custom meshes and terrain. Its Three.js peer requirement allows r180. |
| Recast Navigation core and generators | 0.44.0 | MIT | Builds navigation meshes on demand for walking paths. Wasm is a pinned transitive dependency. |
| Rapier 3D compat | 0.19.3 | Apache-2.0 | Samples deterministic fixed steps into the existing editable track format. |

The included model credits, source links, licenses, default sizes, rig types and clips are in `frontend/public/scene-kit/asset-manifest.json`. The model files ship alongside the corresponding upstream license text. Cesium Man and the animated fox have attribution requirements. Lantern and Toy Car are CC0. All are served from your local CineControl installation.

To add a licensed bundled asset, put a self-contained GLB and its license in `frontend/public/models`, register its model ID, semantic tags, default dimensions, exact clip names and credit in the asset manifest, and rebuild. For a procedural generator, register its function, parameters, schema, and manifest entry, then add a reusable test scene. Re-export the kit so the next ChatGPT session sees the installed catalog. Models imported individually in the editor are stored with their companion files in the browser. Include a project bundle when moving personal models and reference files between computers.

## Behavior and limits

- Geometry remains editable as native stage objects. Parts within a composite object share its parent transform and are authored in the scene JSON. The imported native project JSON retains the geometry so it can reopen without rerunning the generator.
- Stage sequences are independently editable and exportable. The existing **Export all shots** control exports the active stage sequence. Switch stages to export another setting.
- A stage file can contain its stage data, blocking and shots. For a scene JSON with several stages, use **Script** to open the whole project. **Add stage from JSON** and **Replace active stage** use the first stage.
- The geometry generator is deterministic. It creates recognizable previs from reusable models, configured architectural elements, and custom shape assemblies. An exact model can only be selected when present in the manifest. A labeled proxy preserves the ID and role when a request needs an unfamiliar asset.
- Placement and navigation use static geometry. Relationships set initial placement. Actor camera attachments follow translation. Moving obstacles and interactions between dynamic bodies require authored keys. Rapier uses fixed motion samples with static box collision approximations.
- This release includes one humanoid rig and a fox, with bundled clips. Human pose guidance uses projected proxy joints. Specialized actions such as exchanges, fights and lip sync use authored blocking or separately animated models.
- The supplied ChatGPT example was prepared using the master instructions and manifests. JSON import, playback and export were tested locally. A separate external ChatGPT generation run was outside this verification.

## Verification

See [Scene engine validation](../evidence/scene-engine/VERIFICATION.md) for the end-to-end results, exact MP4 probe data, and the independently authored acoustic-vault scene used after completing the master prompt.
