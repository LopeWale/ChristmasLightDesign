# Address-Guided & Photo-Driven 3D Condo Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Lumen3D to reconstruct accurate, 360°-rotatable multi-story buildings with cantilevered/recessed balconies and 3D railings by combining user-uploaded photos/videos (analyzed via Gemini Vision or OpenCV) with optional Google Maps Platform building outlines, roof insights, and Street View orientation, then visually evaluate the pipeline across real condo and home imagery.

**Architecture:** `@lumen3d/shared-schemas` defines `BalconySpec`, `ArchitecturalBuildingSpec`, `MapsBuildingContext`, and balcony surface materials (`balcony_railing`, `balcony_soffit`). `apps/web` adds a server-side `/api/maps/building-context` route (Geocoding v4 `displayPolygon`, Street View bearing, Solar `buildingInsights`) and orchestrates Gemini/Maps enrichment in `/api/reconstruct` while exposing a 1-click 3-Story Condo preset, optional address input, and `< 1s` live Balcony Adjuster in the R3F Studio. `apps/recon-worker` adds `cv_facade_analyzer.py` (pixel-level multi-story/color/balcony extraction when offline) and `architectural_backend.py` (CCW footprint extrusion, 3D balcony slabs/soffits/`42"` railings, and dynamic bounding-sphere camera framing).

**Tech Stack:** TypeScript, Zod, Next.js 14 App Router, React Three Fiber, Three.js, `@google/genai`, Google Maps Platform REST APIs (Geocoding v4, Street View Static, Solar API, Elevation API), Python 3.12, FastAPI, `trimesh`, OpenCV (`cv2`), NumPy, Vitest, Pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-maps-condo-3d-reconstruction-design.md`

## Global Constraints

- Never use single-object 3D mesh generators (`TripoSR`, `TRELLIS`, `Zero123`, `Shap-E`).
- Keep `GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY` strictly server-side (`apps/web/src/app/api/**`), loaded from shell, root `.env`, or `apps/web/.env`; never expose via `NEXT_PUBLIC_*`.
- Use ONLY `@google/genai` (`GoogleGenAI`, `Type`) with default model `gemini-2.5-flash`.
- Every `.glb` emitted by `apps/recon-worker` must have `<= 250,000` triangles, valid unit-length vertex normals, zero `NaN`/`Inf` vertices, and `minY = 0.0`.
- All outbound Google Maps Platform REST requests must include `X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1`, use `Cache-Control: no-store` (zero caching > 30 days), never mix non-Google map data, never train models on Maps content, and require user media for custom builds (never Maps-only `.glb` scraping).
- Fits comfortably in 8 GB unified RAM on Apple M1 (`< 2s` mesh generation).

## Review Focus

1. **Clockwise (CW) or closed GeoJSON `displayPolygon` rings from Geocoding v4:** Extruding a CW ring flips wall normals inward so light splines offset inside walls; `architectural_backend.py` must strip duplicate closing vertices and normalize rings to counter-clockwise (CCW) with outward-facing unit normals (tested in Task 2).
2. **Walk-out 2nd/3rd-floor balcony runs triggering giant ground extension ladders:** Lighting only `balcony_railing` (`0 ft` ladder) and/or `balcony_soffit` (`6 ft` step-ladder) must not recommend a `24–32 ft` sidewalk ladder in `bomMath.ts`, whereas exterior roof runs exceeding a `40 ft` extension ladder must emit a lift/access safety warning (tested in Task 4).
3. **Tall 3–6 story buildings clipping out of Camera `0` (`reference_front.png`) or OrbitControls:** Fixed camera distance clips upper condo floors; `architectural_backend.py` and `StudioViewport.tsx` must scale camera distance and target height from building bounds so door + upper parapet both stay framed (tested in Task 2).
4. **Google Maps Demo Key / Solar API `403` or `404` partial availability:** When `GOOGLE_MAPS_API_KEY` is a Maps Demo Key or a region lacks Solar coverage, `/api/maps/building-context` must degrade gracefully using Geocoding + Street View without failing the request (tested in Task 3).
5. **Dark/twilight or low-contrast walkaround frames in `cv_facade_analyzer.py`:** Must clamp inferred `floors` to `[1, 8]` and wall/trim/roof RGB channels to `[35, 245]` so dark uploads never produce `0`-floor crashes or invisible `(0,0,0)` walls (tested in Task 2).

---

### Task 1: Shared Schemas for Balconies, `ArchitecturalBuildingSpec` & Maps Context

**Files:**
- Modify: `packages/shared-schemas/src/index.ts`
- Modify: `apps/web/src/lib/gemini/client.ts`
- Modify: `apps/web/src/components/panels/Toolbar.tsx`
- Test: `packages/shared-schemas/tests/schemas.test.ts`

**Interfaces:**
- Consumes: Existing `SurfaceMaterialSchema`, `ReconstructionJobSchema` in `packages/shared-schemas/src/index.ts`.
- Produces:
  - Updated `SurfaceMaterialSchema` adding `'balcony_railing' | 'balcony_soffit'`.
  - `BalconySpecSchema` / `BalconySpec`: `{ id: string; floor: number; wallFace: 'front' | 'left' | 'right' | 'rear'; centerOffsetNorm: number; widthMeters: number; depthMeters: number; mountStyle: 'cantilevered' | 'recessed'; railingType: 'metal_picket' | 'glass_panel' | 'solid_parapet' }`.
  - `ArchitecturalBuildingSpecSchema` / `ArchitecturalBuildingSpec`: `{ archetype: 'multi_story_condo' | 'townhouse' | 'single_family_gable' | 'modern_box'; floors: number; metersPerFloor: number; footprintPolygonMeters: [number, number][]; roofStyle: 'flat_parapet' | 'pitched_gable' | 'hip'; roofPitchDegrees: number; wallColorRgb: [number, number, number]; trimColorRgb: [number, number, number]; roofColorRgb: [number, number, number]; windowBaysPerFloor: number; hasGarage: boolean; balconies: BalconySpec[]; sourceSummary: string }`.
  - `MapsBuildingContextSchema` / `MapsBuildingContext`: `{ formattedAddress: string; location: { latitude: number; longitude: number }; footprintPolygonMeters: [number, number][] | null; streetFacingHeadingDeg: number | null; estimatedHeightMeters: number | null; estimatedFloors: number | null; roofPitchDegrees: number | null; streetViewBase64: string | null; streetViewCopyright: string | null; warnings: string[] }`.
  - `ReconstructionJobSchema` extended with `buildingSpec?: ArchitecturalBuildingSpec` (`.nullish().transform((v) => v ?? undefined)`), and `backendUsed` accepting `'vggt' | 'synthetic' | 'architectural'`.

- [ ] **Step 1: Write failing schema tests in `packages/shared-schemas/tests/schemas.test.ts`**

Add test `validates BalconySpec, ArchitecturalBuildingSpec, MapsBuildingContext, and balcony SurfaceMaterials` asserting:
- `SurfaceMaterialSchema.parse('balcony_railing')` and `SurfaceMaterialSchema.parse('balcony_soffit')` succeed.
- A 3-floor `ArchitecturalBuildingSpec` with 2 `BalconySpec` entries (`floor: 2` `metal_picket` cantilevered, `floor: 3` `glass_panel` recessed) parses cleanly; `floors: 0` or `floors: 12` throws.
- `ReconstructionJobSchema.parse({ ..., backendUsed: 'architectural', buildingSpec: validSpec })` preserves `buildingSpec`.

- [ ] **Step 2: Run Vitest to verify RED**

Run: `npm test`
Expected: FAIL (`Invalid enum value` on `'balcony_railing'` / missing `ArchitecturalBuildingSpecSchema`).

- [ ] **Step 3: Implement schemas in `packages/shared-schemas/src/index.ts` and sync `SURFACE_MATERIAL_ENUM_VALUES` in `apps/web/src/lib/gemini/client.ts` & `Toolbar.tsx`**

Export `BalconySpecSchema`, `ArchitecturalBuildingSpecSchema`, `MapsBuildingContextSchema`, update `SurfaceMaterialSchema` and `ReconstructionJobSchema`, and add `'balcony_railing'`, `'balcony_soffit'` to `SURFACE_MATERIAL_ENUM_VALUES` and `SURFACE_MATERIALS`.

- [ ] **Step 4: Run Vitest and typecheck to verify GREEN**

Run: `npm test && npm run typecheck`
Expected: PASS with exit code `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-schemas apps/web/src/lib/gemini/client.ts apps/web/src/components/panels/Toolbar.tsx
git commit -m "feat(schemas): add multi-story condo, balcony, and maps context contracts"
```

---

### Task 2: OpenCV Facade Analyzer & 360° Multi-Story Condo/Balcony `.glb` Builder (`apps/recon-worker`)

**Files:**
- Create: `apps/recon-worker/app/cv_facade_analyzer.py`
- Create: `apps/recon-worker/app/architectural_backend.py`
- Modify: `apps/recon-worker/app/schemas.py`
- Modify: `apps/recon-worker/app/reconstructor.py`
- Modify: `apps/recon-worker/app/main.py`
- Create: `apps/recon-worker/tests/test_architectural_condo.py`

**Interfaces:**
- Consumes: `ArchitecturalBuildingSpec` JSON shape from Task 1; `video_keyframes.py` and `_finalize_part_mesh` / `render_reference_elevation_png` helpers in `apps/recon-worker/app/synthetic_backend.py`.
- Produces:
  - `analyze_facade_images(image_paths: list[Path], partial_overrides: dict | None = None) -> ArchitecturalBuildingSpecModel` in `cv_facade_analyzer.py`.
  - `PRESET_CONDO_3F_2B: ArchitecturalBuildingSpecModel`, `PRESET_SUBURBAN_HOUSE: ArchitecturalBuildingSpecModel`, `normalize_footprint_ccw(ring: list[tuple[float, float]]) -> np.ndarray`, `build_architectural_scene(spec: ArchitecturalBuildingSpecModel) -> trimesh.Scene`, `build_framed_cameras(scene: trimesh.Scene) -> CamerasPayload`, and `ArchitecturalReconstructor(Reconstructor)` in `architectural_backend.py`.
  - Updated FastAPI endpoints in `main.py`:
    - `POST /jobs/demo?preset=condo|house` (`preset="house"` preserves original `SyntheticReconstructor` house; `preset="condo"` builds `PRESET_CONDO_3F_2B` via `ArchitecturalReconstructor`).
    - `POST /jobs/reconstruct` accepts `files: list[UploadFile] = File(default=[])`, `mode: str = Form(default="")`, and `spec_json: str = Form(default="")` (allowing `< 1s` rebuilds from `spec_json` alone when tweaking sliders, or analyzing `files` + merging `spec_json` overrides when uploading media).
    - Named `.glb` nodes: `balcony_railing_*` (`balcony_railing`), `balcony_soffit_*` (`balcony_soffit`), `balcony_slab_*`, `front_door` (`2.033016m` = `6.67 ft` height), `main_walls`, `pitched_gable_roof` / `parapet_roof`, `eaves_gutters`, `front_windows`, `ground_turf`, `front_walkway`.

- [ ] **Step 1: Write failing pytest suite `apps/recon-worker/tests/test_architectural_condo.py`**

Include 5 tests:
1. `test_demo_condo_preset_builds_3_floors_and_2_balconies_with_valid_normals`: `POST /jobs/demo?preset=condo` completes in `< 2.5s`, emits `buildingSpec.floors == 3`, `len(buildingSpec.balconies) == 2`, `scene.glb` contains `balcony_railing` and `balcony_soffit` geometries with unit normals, zero `NaN`s, `minY == 0.0`, and height `> 9.0m`.
2. `test_clockwise_footprint_polygon_normalizes_to_outward_wall_normals`: passes a clockwise (CW) `displayPolygon` with duplicate closing vertex to `build_architectural_scene` and verifies `main_walls` front `+Z` face has outward normal `[0, 0, +1]`.
3. `test_tall_4_story_condo_frames_door_and_parapet_within_camera_0`: builds a 4-story condo (`floors=4`), projects `front_door` bottom and roof top through `cameras[0]` intrinsics/extrinsics, and asserts `0 < u < 1280` and `20 < v < 700`.
4. `test_cv_facade_analyzer_distinguishes_tall_3_story_condo_from_1_story_gable_house_and_clamps_dark_frames`: synthesizes a tall 3-story brick condo image with horizontal balcony bands vs. a wide 1-story beige gable image vs. a near-black twilight frame; verifies `condo_spec.floors >= 3` and `len(condo_spec.balconies) >= 2`, `house_spec.floors <= 2`, and `dark_spec.floors in range(1, 9)` with `all(35 <= c <= 245 for c in dark_spec.wallColorRgb)`.
5. `test_spec_json_rebuild_endpoint_updates_balconies_under_1s`: posts `spec_json` with 3 balconies (`metal_picket`, `glass_panel`, `solid_parapet`) to `POST /jobs/reconstruct` and verifies completion `< 1.5s`.

- [ ] **Step 2: Run pytest to verify RED**

Run: `apps/recon-worker/.venv/bin/pytest apps/recon-worker/tests -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'app.architectural_backend'`).

- [ ] **Step 3: Implement `schemas.py`, `cv_facade_analyzer.py`, `architectural_backend.py`, `reconstructor.py`, and `main.py`**

Key implementation rules:
- `normalize_footprint_ccw`: drop closing vertex if within `1e-4` of index 0, recenter `(x, z)` around `(0, 0)`, check signed shoelace area in `(x, z)` and order vertices so walking `v[i] -> v[i+1]` produces outward wall normals `(dz, 0, -dx)` (pointing `+Z` on the front edge).
- Balcony builder: for each `BalconySpec`, locate target wall segment (`front` = max `+Z` normal, `rear` = min `-Z` normal, `left` = min `-X` normal, `right` = max `+X` normal), place deck slab at `y = (floor - 1) * metersPerFloor`, soffit underside panel (`balcony_soffit_*`) under deck/upper floor, sliding door glass on wall, and `1.07m` (`42"`) 3D perimeter railing (`balcony_railing_*`) matching `metal_picket` (top/bottom rails + vertical pickets every `0.12m`), `glass_panel`, or `solid_parapet`.
- Dynamic Camera `0..3` framing: compute `fov_y` half-tangent from `fy=960, h=720`, set camera `z_dist = max(13.5, 1.45 * max(scene_height / (2 * tan_half_v), scene_width / (2 * tan_half_h)))` and `eye_y = 0.48 * scene_height` so tall condos and wide homes always fit cleanly in `reference_front.png`.

- [ ] **Step 4: Run full pytest suite to verify GREEN**

Run: `apps/recon-worker/.venv/bin/pytest apps/recon-worker/tests -v`
Expected: PASS (`11 passed` across `test_reconstruct.py` and `test_architectural_condo.py`).

- [ ] **Step 5: Commit**

```bash
git add apps/recon-worker
git commit -m "feat(recon-worker): add cv facade analyzer and 360 multi-story balcony builder"
```

---

### Task 3: Google Maps Building Context Route & Gemini Architectural Extraction

**Files:**
- Create: `apps/web/src/lib/maps/buildingContext.ts`
- Create: `apps/web/src/app/api/maps/building-context/route.ts`
- Modify: `apps/web/src/lib/gemini/client.ts`
- Modify: `apps/web/src/app/api/reconstruct/route.ts`
- Modify: `apps/web/src/app/api/calibrate/route.ts`
- Create: `apps/web/tests/mapsAndCondoApi.test.ts`

**Interfaces:**
- Consumes: `MapsBuildingContextSchema`, `ArchitecturalBuildingSpecSchema` from Task 1; `POST /jobs/demo?preset=...` and `POST /jobs/reconstruct` (`spec_json`) from Task 2.
- Produces:
  - `latLngRingToLocalMeters(coords: Array<[number, number]>, streetBearingDeg?: number | null): [number, number][]` and `fetchGoogleMapsBuildingContext(address: string, apiKey: string, fetchImpl?: typeof fetch): Promise<MapsBuildingContext>` in `apps/web/src/lib/maps/buildingContext.ts`.
  - `POST /api/maps/building-context` accepting `{ address: string }` and returning validated `MapsBuildingContext` with `Cache-Control: no-store`.
  - Updated `POST /api/reconstruct`:
    - JSON `{ demo: true, preset?: 'condo' | 'house' }` -> calls worker `/jobs/demo?preset=...`.
    - JSON `{ buildingSpec: ArchitecturalBuildingSpec }` -> calls worker `/jobs/reconstruct` with `spec_json`.
    - Multipart `FormData` (`files`, optional `address`, optional `specJson`) -> if `address` and `GOOGLE_MAPS_API_KEY` exist, enriches footprint/height/Street View via `fetchGoogleMapsBuildingContext`; if `GEMINI_API_KEY` exists (and not mock mode), extracts `ArchitecturalBuildingSpec` via `gemini-2.5-flash` (`responseSchema`); forwards `files` + `spec_json` to worker!
  - Updated `/api/calibrate` mock mode supporting dynamic `front_door` projection using `camera` if passed or matching both Condo & House sample elevations cleanly!

- [ ] **Step 1: Write failing Vitest suite `apps/web/tests/mapsAndCondoApi.test.ts`**

Include 4 tests:
1. `converts GeoJSON [lng, lat] displayPolygon into centered metric [x, z] footprint aligned to street bearing`: verifies a `12m x 10m` lat/lng rectangle converts within `±1%` of `12.0m x 10.0m` and rotates street-facing side to `+Z`.
2. `fetches Geocoding v4 displayPolygon, Street View bearing, and Solar roof height with X-Goog-Maps-Solution-ID header`: passes stubbed `fetchImpl` to `fetchGoogleMapsBuildingContext`, asserts `X-Goog-Maps-Solution-ID === 'gmp_git_agentskills_v1'` on every request, and verifies `estimatedFloors === 3` for a `9.6m` building height.
3. `degrades gracefully when Solar API returns 403 on a Google Maps Demo Key`: stubbed `fetchImpl` returns `200` on Geocoding v4 + Street View Metadata and `403` on Solar API; verifies `MapsBuildingContextSchema.parse(result)` succeeds with non-null `footprintPolygonMeters` and warning note.
4. `rejects missing GOOGLE_MAPS_API_KEY in POST /api/maps/building-context with 503`: verifies clean status `503` without leaking secrets.

- [ ] **Step 2: Run Vitest to verify RED**

Run: `npm test`
Expected: FAIL (`Failed to load url ../src/lib/maps/buildingContext`).

- [ ] **Step 3: Implement `buildingContext.ts`, `/api/maps/building-context/route.ts`, and update `/api/reconstruct/route.ts` & `/api/calibrate/route.ts`**

Ensure `getGoogleMapsApiKey()` in `buildingContext.ts` reads `process.env.GOOGLE_MAPS_API_KEY` (preloaded from root `.env`), never logs or returns the key, sends `X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1`, and sets `Cache-Control: no-store`. Also update `/api/calibrate/route.ts` mock box calculation to project `front_door` (`[-0.475..0.475, y0..y0+2.033, z_front]`) dynamically when `camera` + `doorBounds` or `preset === 'condo'` is supplied!

- [ ] **Step 4: Run Vitest and typecheck to verify GREEN**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/maps apps/web/src/app/api apps/web/src/lib/gemini/client.ts apps/web/tests/mapsAndCondoApi.test.ts
git commit -m "feat(maps-api): add google maps building context and gemini condo extraction"
```

---

### Task 4: Walk-Out Balcony Ladder Math, Condo HOA Hardware BOM & Studio UI

**Files:**
- Modify: `apps/web/src/lib/geometry/bomMath.ts`
- Modify: `apps/web/src/app/api/copilot/bom/route.ts`
- Modify: `apps/web/src/components/canvas/HouseMesh.tsx`
- Modify: `apps/web/src/components/canvas/StudioViewport.tsx`
- Create: `apps/web/src/components/panels/BuildingAdjuster.tsx`
- Modify: `apps/web/src/components/panels/Toolbar.tsx`
- Modify: `apps/web/src/store/useStudioStore.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/tests/bomMath.test.ts`
- Modify: `apps/web/tests/copilot.test.ts`

**Interfaces:**
- Consumes: `ArchitecturalBuildingSpec` on `job.buildingSpec`, `/api/reconstruct` (`preset: 'condo' | 'house'`, `{ buildingSpec }`, multipart `address`), and `'balcony_railing'` / `'balcony_soffit'` from Tasks 1–3.
- Produces:
  - Updated `computeDesignTelemetry` in `bomMath.ts`:
    - Runs on `'balcony_railing'` require `0 ft` ladder (reachable standing on walk-out balcony deck); runs on `'balcony_soffit'` require `6 ft` step-ladder.
    - Non-balcony exterior runs compute `computeRecommendedLadderFeet(maxExteriorElevationFeet)`. If `recommendedLadderFeet > 40`, appends a safety warning recommending boom-lift/professional access.
    - `recommendedLadderFeet = Math.max(balconyStepLadderFeet, exteriorLadderFeet)`.
  - Updated `mapSurfaceHardwareRule` in `bom/route.ts`:
    - `'balcony_railing'` -> `'Heavy-Duty UV-Stabilized Railing Zip-Ties & Non-Marring Deck Clamps (100-Pack)'`
    - `'balcony_soffit'` -> `'Outdoor Weatherproof Command / 3M VHB Soffit Cord Clips (50-Pack)'`
  - `HouseMesh.tsx`: infers `'balcony_railing'` (`name.includes('balcony_railing')`) and `'balcony_soffit'` (`name.includes('balcony_soffit')`), disposes previous Three.js geometries/materials on `glbUrl` swap, and reports full `THREE.Box3` bounds to `StudioViewport`.
  - `StudioViewport.tsx`: auto-fits camera position & `OrbitControls` target to `[center.x, center.y, center.z]` of loaded mesh bounding box so rotating 360° around a 3-story condo is centered and smooth.
  - `BuildingAdjuster.tsx` + `page.tsx`:
    - Header buttons: **Sample 3-Story Condo (2 Balconies)** (`data-testid="btn-load-sample-condo"`), **Sample House** (`data-testid="btn-load-sample-house"`), optional **Street Address (Google Maps)** input (`data-testid="input-street-address"`), and **Upload Photos / Video**.
    - Left sidebar collapsible **3D Building & Balcony Adjuster** (`BuildingAdjuster.tsx`, shown whenever `job?.buildingSpec` is present): edit `floors` (`1..6`), `roofStyle`, add/remove/edit `balconies` (`floor`, `wallFace`, `mountStyle`, `railingType`), and click **Rebuild 3D Mesh** (`data-testid="btn-rebuild-spec"`).

- [ ] **Step 1: Write failing tests in `apps/web/tests/bomMath.test.ts` and `apps/web/tests/copilot.test.ts`**

Add tests asserting:
1. In `bomMath.test.ts`: a 3rd-floor (`y = 7.2m ≈ 23.6 ft`) `balcony_railing` run yields `maxHeightFeet > 20` and `recommendedLadderFeet === 0`; adding a 3rd-floor `balcony_soffit` run yields `recommendedLadderFeet === 6`; adding a 5-story (`45 ft`) `asphalt_shingle` roof run yields `recommendedLadderFeet > 40` and emits a `40 ft` lift/access warning.
2. In `copilot.test.ts`: `POST /api/copilot/bom` with `balcony_railing` and `balcony_soffit` runs emits non-drilling railing clamps/zip-ties and adhesive soffit clips.

- [ ] **Step 2: Run Vitest to verify RED**

Run: `npm test`
Expected: FAIL (`expected 28 to be 0` on 3rd-floor `balcony_railing` ladder height).

- [ ] **Step 3: Implement `bomMath.ts`, `bom/route.ts`, `HouseMesh.tsx`, `StudioViewport.tsx`, `BuildingAdjuster.tsx`, `useStudioStore.ts`, and `page.tsx`**

Also update auto-calibration in `page.tsx`: when `GEMINI_MOCK_MODE` returns a generic house box or when `sceneGroupRef` contains a named `front_door` mesh on an architectural build, if `calibrateScaleFromDetection` falls back or when calibrating a condo, intersect/verify cleanly against `front_door` (`6.67 ft` exact height on both Condo and House builds!).

- [ ] **Step 4: Run Vitest, typecheck, and production build to verify GREEN**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS with exit code `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(condo-studio): add walk-out balcony math, hoa bom clips, and live 3d adjuster"
```

---

### Task 5: Real Online Condo/Home Visual Evaluation, Documentation & Compliance Gate

**Files:**
- Modify: `apps/web/tests/studio.spec.ts`
- Modify: `AGENTS.md`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: Complete stack from Tasks 1–4.
- Produces:
  - Updated Playwright E2E suite `apps/web/tests/studio.spec.ts` testing BOTH the Sample House workflow AND the **3-Story Condo (2 Balconies)** workflow (loading condo, orbiting/calibrating, lighting both balconies, verifying `0 ft` walk-out ladder telemetry, tweaking balcony railing via `BuildingAdjuster`, and exporting HOA-safe BOM).
  - Real-imagery visual evaluation executed via scratch harness fetching real open-licensed Wikimedia Commons photos + synthesized multi-frame pan/tilt walkaround `.mp4` videos of:
    1. **3-Story Multi-Balcony Condo Building**
    2. **3-Story Urban Brick Townhome**
    3. **2-Story Pitched-Roof Residence**
    and capturing high-DPI front, 360° oblique/side rotation, and Night-Bloom balcony lighting screenshots into the conversation artifact directory for visual inspection.
  - Updated `.env.example`, `AGENTS.md`, and `README.md` documenting `GOOGLE_MAPS_API_KEY`, the free Google Maps Demo Key setup, API restrictions, and Google Maps Platform ToS compliance.

- [ ] **Step 1: Add Playwright E2E test for 3-Story Condo & Balcony Adjuster in `apps/web/tests/studio.spec.ts`**

Add test `3-Story Condo (2 Balconies): Load Condo -> Light Both Balcony Railings -> Verify 0ft Walk-Out Ladder & HOA BOM -> Rebuild via Balcony Adjuster`.

- [ ] **Step 2: Run `npm run build && npm run test:e2e` to verify E2E passes**

Run: `npm run build && npm run test:e2e`
Expected: PASS (`2 passed`).

- [ ] **Step 3: Execute Real Online Building Photo/Video Visual Evaluation & Inspect Screenshots**

Fetch 3 real Wikimedia Commons residential/condo facade photos, generate walkaround `.mp4` video clips, upload them through `POST /api/reconstruct`, render multi-angle 3D rotation views + decorated 3-story 2-balcony Night-Bloom screenshots, and visually verify every render with `read_file`.

- [ ] **Step 4: Update `.env.example`, `AGENTS.md`, and `README.md` + Run Google Maps `compliance-review` check**

Document `GOOGLE_MAPS_API_KEY`, Maps Demo Key quickstart, HTTP/IP key restrictions, and run full monorepo verification (`pytest`, `npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e`).

- [ ] **Step 5: Commit**

```bash
git add .env.example AGENTS.md README.md apps/web/tests/studio.spec.ts
git commit -m "feat(eval): add 3-story condo e2e tests, maps docs, and visual evaluation"
```
