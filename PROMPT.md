# Autonomous Build Specification: Lumen3D (3D Exterior Reconstruction & Holiday Lighting Studio)

## Role & Objective
You are an autonomous Principal Full-Stack & 3D Graphics Engineer. Build **Lumen3D**, a production-grade monorepo web application where a user uploads multi-view photos (or a short walkaround video) of a building exterior, reconstructs a metric-calibrated 3D collider mesh, designs holiday light installations in any 3D orientation with realistic night-bloom rendering, and uses the Gemini API (`@google/genai`) for spatial auto-calibration, visual design critique, concept generation, and an exact hardware/electrical Bill of Materials (BOM).

Execute this build **strictly in order from Gate 0 to Gate 5**. Do NOT advance to the next gate until all verification commands for the current gate pass with exit code `0`. Create a clean git commit at the end of each passed gate.

---

## Hard Architectural Guardrails (Non-Negotiable)

1. **Multi-View Scene Reconstruction Only:** NEVER use single-object 3D generators (`TripoSR`, `TRELLIS`, `Zero123`, `Shap-E`). Exterior facades require multi-view geometric reconstruction (`facebookresearch/vggt` + `Open3D` TSDF mesh extraction) so rooflines, gutters, porches, and yards retain real perspective geometry.
2. **Dual-Mode Reconstruction Worker (`vggt` + `synthetic`):** Coding sandboxes and CI runners often lack an NVIDIA CUDA GPU. `apps/recon-worker` MUST implement a clean `Reconstructor` interface with two backends controlled by `RECON_BACKEND=auto|vggt|synthetic`:
   - `vggt`: Runs `facebookresearch/vggt` on CUDA/MPS + `Open3D` `ScalableTSDFVolume` to output `scene.glb` and `cameras.json`.
   - `synthetic` (auto-selected when CUDA is unavailable or in CI tests): Uses `trimesh` / `numpy` to procedurally generate a realistic multi-material textured house `scene.glb` (gable roof ridges, eaves/gutters, front door, garage door, 2 cylindrical porch columns, front shrubs, and walkway) with matching pinhole `cameras.json` and a rendered front elevation PNG. This guarantees 100% deterministic E2E testing without stalling on GPU availability.
3. **Mandatory `.glb` Surface Mesh with Vertex Normals:** Every reconstruction job MUST emit a decimated triangle mesh (`scene.glb`, <= 300k faces) with computed vertex normals so Three.js `Raycaster` hits crisp surfaces and offsets light splines along surface normals without z-fighting.
4. **Deterministic Geometry & Electrical Math First, LLM Second:** NEVER ask Gemini to estimate wire footage, bulb counts, or electrical amps from an image. Compute exact 3D spline arc-lengths (in feet), maximum height above ground, bulb counts, wattage, and NEC circuit loads deterministically in TypeScript first, then pass that structured `DesignTelemetry` JSON to Gemini.
5. **Pinned Gemini SDK & Security:**
   - Use ONLY the official `@google/genai` package (`import { GoogleGenAI, Type } from '@google/genai'`). NEVER install or import the deprecated `@google/generative-ai` package.
   - Keep `GEMINI_API_KEY` strictly server-side inside Next.js App Router API routes (`apps/web/src/app/api/...`). Never expose keys via `NEXT_PUBLIC_*`.
   - Use `gemini-2.5-flash` as the default multimodal/spatial model (configurable via `GEMINI_MODEL` env var).
6. **WebGL Screenshot Buffer Preservation:** Configure the React Three Fiber `<Canvas gl={{ preserveDrawingBuffer: true, antialias: true }}>` so capturing viewport PNG snapshots (`gl.domElement.toDataURL('image/png')`) for Gemini multimodal critique never produces a blank black frame.

---

## Target Monorepo Structure

```text
lumen3d/
├── AGENTS.md                        # Persistent repo rules, run commands, & gate status
├── README.md                        # Setup & one-command run instructions (GPU & Synthetic modes)
├── package.json                     # pnpm or npm workspaces root
├── packages/
│   └── shared-schemas/              # TypeScript + Zod contracts shared across frontend & API routes
│       └── src/index.ts             # SceneMetadata, CameraPose, LightRun, DesignTelemetry, BOMReport
├── apps/
│   ├── recon-worker/                # Python 3.11+ FastAPI reconstruction microservice (port 8001)
│   │   ├── pyproject.toml
│   │   ├── app/
│   │   │   ├── main.py              # POST /jobs/reconstruct, GET /jobs/{id}, static artifact serving
│   │   │   ├── schemas.py           # Pydantic v2 models matching shared-schemas
│   │   │   ├── video_keyframes.py   # OpenCV frame extraction + Laplacian blur filter (~2 fps, max 20)
│   │   │   ├── vggt_backend.py      # VGGT forward pass + Open3D ScalableTSDFVolume -> .glb
│   │   │   └── synthetic_backend.py # Procedural house .glb + cameras.json + reference_front.png
│   │   └── tests/
│   │       └── test_reconstruct.py  # Pytest suite verifying job lifecycle, .glb validity, normals
│   └── web/                         # Next.js (App Router, TypeScript, Tailwind CSS) (port 3000)
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx                         # Main Studio layout (Upload/Demo -> Calibrate -> Design -> BOM)
│       │   │   └── api/
│       │   │       ├── reconstruct/route.ts         # Proxies/polls recon-worker jobs
│       │   │       ├── calibrate/route.ts           # @google/genai 2D box detection for door/surfaces
│       │   │       └── copilot/
│       │   │           ├── critique/route.ts        # Multimodal night-render critique + 3 design presets
│       │   │           └── bom/route.ts             # Surface-aware hardware & electrical shopping plan
│       │   ├── store/
│       │   │   └── useStudioStore.ts                # Zustand store with undo/redo history & JSON export/import
│       │   ├── lib/
│       │   │   ├── geometry/
│       │   │   │   ├── raycastCalibration.ts        # Unprojects 2D [ymin,xmin,ymax,xmax] box onto .glb
│       │   │   │   ├── splineGenerators.ts          # Linear/Eave, Helical Wrap, Brush Scatter, Stakes
│       │   │   │   └── bomMath.ts                   # Arc-length (ft), bulbs, watts, NEC 15A/80% math, ladder rule
│       │   │   └── gemini/
│       │   │       └── client.ts                    # @google/genai wrapper + strict Type schemas
│       │   └── components/
│       │       ├── canvas/
│       │       │   ├── StudioViewport.tsx           # R3F Canvas, Day/Dusk/Night lighting, Bloom postprocessing
│       │       │   ├── HouseMesh.tsx                # Loads .glb, applies night material tint, pointer raycasting
│       │       │   ├── InstancedBulbsLayer.tsx      # Single-draw-call InstancedMesh bulbs + pooled PointLights
│       │       │   └── CalibrationOverlay.tsx       # Auto door-scale badge + 2-click manual distance ruler
│       │       └── panels/
│       │           ├── Toolbar.tsx                  # Tool selector, Bulb type, Spacing, Color pattern, Day/Night
│       │           ├── TelemetryHUD.tsx             # Live footage, bulb count, watts, amps, circuit load bar
│       │           └── CopilotDrawer.tsx            # Critique, 1-click Concept Presets, & CSV/MD BOM export
│       └── tests/
│           ├── bomMath.test.ts                      # Vitest deterministic geometry & electrical unit tests
│           ├── splineGenerators.test.ts             # Vitest parametric helix, linear, scatter, stake tests
│           └── studio.spec.ts                       # Playwright E2E flow
```

---

## Core Data Contracts (`packages/shared-schemas/src/index.ts`)

Define and export strict Zod + TypeScript types for:
1. **`BulbPreset`**: `'C9_LED' | 'C7_LED' | 'MINI_5MM_LED' | 'ICICLE_DROP_LED' | 'RGB_SOFFIT_PUCK' | 'PATHWAY_C9_STAKE'` (with standard watts-per-bulb and default spacing in inches).
2. **`ToolMode`**: `'SELECT' | 'CALIBRATE_RULER' | 'LINEAR_EAVE' | 'HELICAL_WRAP' | 'SURFACE_SCATTER' | 'PATHWAY_STAKE'`.
3. **`SurfaceMaterial`**: `'asphalt_shingle' | 'metal_gutter' | 'wood_fascia' | 'brick_masonry' | 'vinyl_siding' | 'stucco' | 'column_post' | 'foliage_shrub' | 'ground_turf' | 'unknown'`.
4. **`LightRun`**:
   - `id`, `name`, `toolMode`, `bulbPreset`, `spacingInches`, `colorsHex: string[]`, `pattern: 'SOLID' | 'ALTERNATING' | 'CANDY_CANE' | 'TWINKLE'`
   - `controlPoints: [number, number, number][]` (3D scene coordinates)
   - `helixParams?: { baseCenter: [number, number, number]; topCenter: [number, number, number]; radius: number; turns: number }`
   - `bulbPositions: [number, number, number][]`
   - `surfaceMaterial: SurfaceMaterial`
5. **`DesignTelemetry`**:
   - `feetPerSceneUnit: number`
   - `calibrationSource: 'AUTO_DOOR' | 'AUTO_GARAGE' | 'MANUAL_RULER' | 'DEFAULT'`
   - `runs: Array<{ id: string; name: string; toolMode: ToolMode; surfaceMaterial: SurfaceMaterial; lengthFeet: number; bulbPreset: BulbPreset; bulbCount: number; watts: number; maxElevationFeet: number }>`
   - `totals: { totalLengthFeet: number; totalBulbs: number; totalWatts: number; totalAmps120V: number; gfci15ACircuitsNeeded: number; maxHeightFeet: number; recommendedLadderFeet: number; warnings: string[] }`

---

## Pinned `@google/genai` Usage Pattern

Use this exact SDK pattern in `apps/web/src/lib/gemini/client.ts` (never use legacy SDK methods):

```typescript
import { GoogleGenAI, Type } from '@google/genai';

export function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in server environment');
  }
  return new GoogleGenAI({ apiKey });
}

// Example structured JSON call:
// const response = await ai.models.generateContent({
//   model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
//   contents: [
//     { inlineData: { mimeType: 'image/png', data: base64Png } },
//     { text: promptText }
//   ],
//   config: {
//     responseMimeType: 'application/json',
//     responseSchema: {
//       type: Type.OBJECT,
//       properties: { ... },
//       required: [...]
//     }
//   }
// });
```

Also provide a clean deterministic fallback response in API routes ONLY when `GEMINI_MOCK_MODE=true` (for offline automated tests); when `GEMINI_API_KEY` is present, execute real Gemini API calls.

---

## Gated Execution Plan

### Gate 0: Workspace Scaffold, Shared Schemas & `AGENTS.md`
1. Initialize the monorepo (`packages/shared-schemas`, `apps/web`, `apps/recon-worker`).
2. Write `AGENTS.md` documenting architecture invariants, ports (`3000` web, `8001` worker), env vars (`GEMINI_API_KEY`, `RECON_BACKEND`, `RECON_WORKER_URL`), and gate status checkboxes.
3. Implement and build `packages/shared-schemas` with unit validation tests.
- **Gate 0 Verification:** `npm run typecheck` and schema unit tests pass with exit code `0`. Commit `chore: complete gate 0 workspace and shared schemas`.

### Gate 1: Multi-View 3D Reconstruction Service (`apps/recon-worker`)
1. Build FastAPI endpoints:
   - `POST /jobs/reconstruct`: Accepts multipart images (`JPEG`/`PNG`/`WEBP`) or `.mp4`/`.mov` video, plus optional `mode=auto|vggt|synthetic`. Also support `POST /jobs/demo` to trigger an instant synthetic house build from the UI with one click ("Load Sample House").
   - `GET /jobs/{job_id}`: Returns status (`queued | processing | completed | failed`), progress %, `glbUrl`, `camerasUrl`, `referenceImageUrl`, and mesh stats (`vertexCount`, `faceCount`, `boundingBox`).
2. Implement `synthetic_backend.py`: Generates a clean multi-part house `.glb` (main walls, pitched gable roof, eaves/gutters, front door at known geometry coordinates, 2 front porch columns, 2 boxwood shrubs, front walkway), computes vertex normals, exports `cameras.json` (intrinsics + extrinsics for front/left/right views), and renders `reference_front.png` matching camera `0`.
3. Implement `vggt_backend.py`: Wraps `facebookresearch/vggt` inference (`torch.cuda.amp.autocast` when CUDA is present) -> filters sky/low-confidence depth -> fuses RGB-D frames in `open3d.pipelines.integration.ScalableTSDFVolume` -> extracts mesh, computes vertex normals, simplifies to <= 250k triangles, and exports `scene.glb` + `cameras.json`.
- **Gate 1 Verification:** Run `pytest apps/recon-worker/tests` verifying: (a) `synthetic` job completes in < 3s, (b) exported `scene.glb` loads cleanly in `trimesh` with non-zero faces, valid vertex normals, and zero `NaN` vertices, (c) video keyframe extractor handles sample frames cleanly. Commit `feat(recon-worker): complete gate 1 3d reconstruction service`.

### Gate 2: Gemini Spatial Calibration & 3D Back-Projection
1. Implement `POST /api/calibrate` using `@google/genai`:
   - Sends `reference_front.png` (or uploaded primary facade photo) to Gemini requesting structured JSON with normalized `0..1000` `[ymin, xmin, ymax, xmax]` bounding boxes for `front_door` (standard height `6.67 ft`), `garage_door` (standard height `7.0 ft`), and detected `zones[]` tagged with `SurfaceMaterial`.
2. Implement `raycastCalibration.ts`:
   - Converts normalized `[ymin, xmin, ymax, xmax]` pixel coordinates of `front_door` top-center and bottom-center into 3D rays using Camera `0` intrinsics/extrinsics from `cameras.json`.
   - Intersects those rays against the loaded Three.js `scene.glb` mesh (`THREE.Raycaster`), computes 3D Euclidean distance `d_door`, and sets `feetPerSceneUnit = 6.67 / d_door` (with sanity bounds fallback to `garage_door` or manual ruler).
3. Implement `CalibrationOverlay.tsx`:
   - Displays current calibration status (`Auto-calibrated via Front Door: 6.67 ft`) and a 2-click `CALIBRATE_RULER` mode where clicking any two points on the 3D house prompts for real-world feet/inches and updates `feetPerSceneUnit` reactively across all existing light runs.
- **Gate 2 Verification:** Vitest unit test verifies camera ray unprojection + mesh intersection computes `feetPerSceneUnit` within ±2% of ground truth on known test geometry; `POST /api/calibrate` schema validation test passes. Commit `feat(calibration): complete gate 2 gemini spatial scale calibration`.

### Gate 3: Interactive 3D Night Studio & Parametric Multi-Orientation Light Tools
1. Build `StudioViewport.tsx` & `HouseMesh.tsx`:
   - OrbitControls with damping, `Day / Dusk / Night` lighting selector, darkened cool-blue moonlight material tint in `Night` mode, and `@react-three/postprocessing` `<Bloom mipmapBlur luminanceThreshold={0.8} intensity={1.5} />`.
   - Hover cursor preview ring aligned to surface hit normal.
2. Implement all 4 parametric generators in `splineGenerators.ts` (offsetting all surface hits by `+0.02` scene units along `hit.face.normal`):
   - **Linear / Eave (`LINEAR_EAVE`):** Multi-point polyline along gutters, ridges, gables, or window frames (`Enter` or double-click finishes run). Supports `C9_LED`, `C7_LED`, `MINI_5MM_LED`, `ICICLE_DROP_LED` (generates vertical hanging sub-drops every 6"), and `RGB_SOFFIT_PUCK`.
   - **Helical Column / Trunk Wrap (`HELICAL_WRAP`):** Click base of pillar/trunk -> click top -> drag/adjust radius & turns slider -> generates parametric 3D helix `P(t)` around the cylinder axis populated at exact bulb spacing.
   - **Surface Net / Foliage Scatter (`SURFACE_SCATTER`):** Paint brush radius across shrub/tree mesh triangles -> Poisson/minimum-distance surface point sampling for natural bush net/wrap lighting.
   - **Pathway Stakes (`PATHWAY_STAKE`):** Ground-snapped polyline placing vertical stake geometry + glowing C9 bulbs at 24"–36" spacing.
3. Build `InstancedBulbsLayer.tsx`:
   - Render ALL bulbs across the scene using batched `THREE.InstancedMesh` with per-instance `instanceColor` + emissive bloom shader material + optional subtle twinkle animation in `useFrame`.
   - Pool at most `20` dynamic `THREE.PointLight` nodes distributed across active runs so walls, eaves, and snow/ground receive realistic colored bounce light without dropping below 55 FPS or triggering WebGL shader recompilation stalls.
4. Wire Zustand undo/redo (`Ctrl+Z` / `Ctrl+Y`), delete run, color/pattern live editing, and JSON project save/load.
- **Gate 3 Verification:** Vitest tests pass for all 4 spline generators (verifying exact bulb spacing, icicle drop generation, and helix point counts) and `npm run build` succeeds cleanly. Commit `feat(studio-3d): complete gate 3 interactive night viewport and spline tools`.

### Gate 4: Deterministic Footage, NEC Electrical & Ladder Safety Engine (`bomMath.ts`)
1. Implement pure, deterministic calculation functions producing `DesignTelemetry`:
   - Accurate polyline/helix arc-length in feet (`sceneArcLength * feetPerSceneUnit`), plus scatter equivalent strand length.
   - Exact wattage per bulb preset (e.g., `C9_LED = 0.8W`, `C7_LED = 0.6W`, `MINI_5MM_LED = 0.07W`, `ICICLE_DROP_LED = 0.07W`, `RGB_SOFFIT_PUCK = 1.5W`).
   - Electrical load math: `totalAmps120V = totalWatts / 120`, `gfci15ACircuitsNeeded = Math.max(1, Math.ceil(totalWatts / 1440))` (NEC 80% continuous load limit of `12A / 1440W` on a 15A circuit).
   - Series run warning whenever any single continuous run exceeds `210W` or `200 ft` end-to-end limit.
   - Elevation & ladder math: Measure `maxElevationFeet` relative to mesh ground plane `minY`, and compute `recommendedLadderFeet = Math.ceil((maxElevationFeet * 1.03 + 3) / 4) * 4` (accounting for the 4:1 ladder angle ratio + 3-foot extension above roof contact point).
2. Render live numbers in `TelemetryHUD.tsx` with visual circuit-load meter and active warnings.
- **Gate 4 Verification:** Comprehensive Vitest suite (`bomMath.test.ts`) verifying footage scaling, NEC 1,440W circuit rollover, 210W run warning, and 4:1 ladder rule edge cases. Commit `feat(telemetry): complete gate 4 deterministic bom and electrical math`.

### Gate 5: Gemini Multimodal Design Co-Pilot, Hardware BOM & E2E Verification
1. Implement `POST /api/copilot/critique` (`@google/genai`):
   - Inputs: Primary daylight house image + current 3D night canvas PNG (`preserveDrawingBuffer` snapshot) + `DesignTelemetry` JSON + optional user style prompt (e.g., *"Warm classic architectural"* or *"High-energy candy cane"*).
   - Structured JSON response (`responseSchema`):
     - `overallScore` (1–10), `architecturalCritique`, `colorHarmonyNotes`, `darkZoneSuggestions[]`
     - `conceptPresets[]`: 3 actionable style variations, each containing per-run style mutations (`bulbPreset`, `colorsHex`, `pattern`, `spacingInches`) plus suggested new zones so clicking **"Preview Concept"** in `CopilotDrawer.tsx` immediately re-colors/re-styles the 3D viewport!
2. Implement `POST /api/copilot/bom` (`@google/genai`):
   - Inputs: `DesignTelemetry` JSON + detected `SurfaceMaterial` zones.
   - Structured JSON response (`BOMReport`):
     - `spools[]`: Spool SKU description (e.g., `25ft C9 Warm White LED Spool, 12" spacing` or `SPT-1 Custom Socket Wire + Vampire Plugs`), net footage, +12% slack/waste footage, and integer spool quantity to purchase.
     - `mountingHardware[]`: Surface-matched clips (All-in-One shingle/gutter clips for eaves/shingles, brick clips or outdoor hot-glue tabs for masonry, UV zip-ties for column helices, ground stakes for walkways).
     - `powerDistribution[]`: Outdoor SJTW 12/3 or 14/3 extension cords, weatherproof 3-way splitters, inline male/female Gilbert/vampire plugs, smart outdoor Dusk-to-Dawn Wi-Fi timer plugs.
     - `safetyAndInstallPlan[]`: Step-by-step installation order (ground prep -> clip attachment -> roof runs -> column wraps -> GFCI load balancing) incorporating exact `recommendedLadderFeet` and circuit counts from `DesignTelemetry`.
   - Add **Export BOM (Markdown & CSV)** buttons in `CopilotDrawer.tsx`.
3. Write Playwright E2E test (`apps/web/tests/studio.spec.ts`) covering:
   - Launch app -> click **"Load Sample House"** (triggers `recon-worker` synthetic `.glb` build) -> verify `.glb` renders in 3D Night Canvas -> calibrate scale -> programmatically/UI place a roofline run and column wrap -> verify `TelemetryHUD` updates live footage & watts -> request Co-Pilot Critique & BOM -> verify structured BOM table renders and downloads CSV.
- **Gate 5 Verification:** Run full test suite across monorepo (`pytest`, `vitest run`, `npm run build`, and Playwright E2E). Update `AGENTS.md` marking Gates 0–5 complete and write clear startup instructions in `README.md`. Commit `feat(copilot): complete gate 5 gemini design copilot bom and e2e verification`.
