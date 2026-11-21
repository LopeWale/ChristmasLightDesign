# Design Spec: Photorealistic 3D Tiles, Apple Silicon Splat/Depth & Full-Bleed Spatial Studio Redesign

**Date:** 2026-11-21
**Status:** Draft (Pending User Approval)
**Sizing:** Project (Touches `@lumen3d/shared-schemas`, `apps/web` 3D engine, Google 3D Tiles proxy, client fallback, full UI/UX overhaul, `scripts/dev-worker.sh`, and `apps/recon-worker` Apple Silicon `mps` depth/splat pipeline)

---

## 1. Intent & Why

Real-world testing on the user's MacBook Pro (`1007 N Shartel Ave, Oklahoma City, OK`) exposed three fundamental product failures in the earlier dashboard:
1. **Confusing, backwards UX:** Opening `localhost:3000` dumped two permanent technical sidebars (*Linear / Eave*, *Helix Wrap*, *Critique Night Render*, *Generate Hardware BOM*) and a `0.0 ft` telemetry box onto an empty screen—squeezing the 3D canvas into the middle, turning **Day** mode into a flat baby-blue void where white HUD text became completely illegible, and giving the street-address input no **Submit / Load Building** action.
2. **Toy CAD geometry instead of 2026 open-source 3D rendering:** Typing a real US street address should stream the **actual photorealistic 3D textured building** directly into Three.js using **`NASA-AMMOS/3DTilesRendererJS`** (`3d-tiles-renderer/r3f` + `GoogleCloudAuthPlugin` + `ReorientationPlugin`), while phone walkaround uploads on Macs should support Apple Silicon `mps` neural depth/splat reconstruction alongside `@react-three/drei` `<Splat>`.
3. **Fragile `npm run dev` startup (`fetch failed`):** Hardcoding `apps/recon-worker/.venv/bin/uvicorn` broke immediately when the user ran `npm run dev` inside a root `(.venv)`, returning `502` / `"fetch failed"` with no recovery.

The goal of this redesign is to make Lumen3D feel like a modern 2026 spatial design app (inspired by [`pascalorg/editor`](https://github.com/pascalorg/editor), [`NASA-AMMOS/3DTilesRendererJS`](https://github.com/NASA-AMMOS/3DTilesRendererJS), and World Labs' Three.js splat workflow): **type an address or drop walkaround media -> immediately orbit your real 3D building in a 100% full-bleed sky-lit viewport -> click railings, rooflines, columns, or walkways using a clean floating dock.**

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **Address -> Live Photorealistic 3D Building (`3d-tiles-renderer/r3f`):** Entering an address (e.g., `1007 N Shartel Ave, Oklahoma City, OK`) and pressing **Enter** or clicking **Load 3D Building** geocodes the coordinates + ground elevation and streams Google Photorealistic 3D Tiles centered at local `(0, 0, 0)` meters (`ENU`, `1 scene unit = 1 meter = 3.28084 ft`, pre-calibrated as `'MAPS_3D_TILES'`) via a server-side Next.js proxy (`/api/maps/tiles/[...path]`) that keeps `GOOGLE_MAPS_API_KEY` private.
- **Direct Raycasting & Night-Dimming on Photorealistic 3D Tiles:** Users orbit 360° around the real 3D building and click directly onto tiled roofs, balcony ledges, walls, bushes, and walkways to place glowing 3D holiday light strands; Dusk and Night modes dim tile albedo/environment brightness so emissive `<Bloom>` bulbs pop realistically against darkened architecture.
- **Zero-Failure `npm run dev` & Instant In-Browser Fallback:**
  - `scripts/dev-worker.sh` detects active `$VIRTUAL_ENV`, root `./.venv`, or `apps/recon-worker/.venv`, and auto-creates/installs `apps/recon-worker/.venv` if missing.
  - Sample presets (*3-Story Condo (2 Balconies)* and *Suburban House*) also have an instant in-browser procedural Three.js builder (`proceduralBuilding.ts`) if the Python worker is unreachable, and Address -> 3D Tiles requires zero Python worker—eliminating `"fetch failed"` dead ends.
- **Apple Silicon (`mps`) Depth/Splat Support (`apps/recon-worker` + `<Splat>`):** Extend `recon-worker` with an optional PyTorch `mps`/`cuda`/`cpu` monocular/multi-view depth fusion backend (`da3_mps_backend.py`) and render `.splat` assets in R3F via `@react-three/drei` `<Splat>` when present, while keeping `< 1.5s` `ArchitecturalReconstructor` as zero-weight fallback.
- **Full-Bleed Progressive Spatial UI (`pascalorg/editor` pattern):**
  - **Before a building is loaded:** Full-screen atmospheric 3D viewport with **zero sidebars** and **zero empty HUDs**—only a centered glass launcher card (Address search form with **Load 3D Building** submit button, drag-and-drop Photo/Video zone, and two 1-click sample pills).
  - **Once a building is loaded:** Full-bleed 100vw × 100vh 3D canvas with physical `<Sky>` shader (Day/Dusk/Night), `<ContactShadows>`, subtle ground `<Grid>`, 3D orientation `<GizmoHelper>`, a **floating bottom tool dock** with plain-English labels + inline bulb/color popover, a **high-contrast dark obsidian telemetry pill** (`>= 12:1` contrast even against bright Day skies), and **slide-over drawers** for *AI Co-Pilot* and *Shopping List (BOM)* that stay closed until clicked.

### Non-Goals
- **Offline `.glb` downloading/export of Google Photorealistic 3D Tiles:** Strictly prohibited by Google Maps Platform Terms of Service; tiles stream live in-memory via session tokens and only user-created `LightRun` coordinates/JSON are exported.
- **Mandatory multi-gigabyte ML weight downloads on `npm install`:** PyTorch `mps` depth/splat weights remain optional so `npm run dev` starts in seconds on a fresh clone.

### Anti-Goals (Failure Conditions Even If Technically Working)
- Showing permanent left/right sidebars or `0.0 ft` telemetry on the initial landing screen before a building is loaded.
- Any text input (like the street address bar) that lacks an obvious submit button and `Enter`-key handler.
- Low-contrast white text over bright Day skies (`TelemetryHUD` or floating pills becoming unreadable in `DAY` mode).
- Raw technical error strings like `"fetch failed"` shown to the user without human-readable recovery or fallback.
- Exposing `GOOGLE_MAPS_API_KEY` or `GEMINI_API_KEY` in client bundles or `NEXT_PUBLIC_*` env vars.

---

## 3. Constraints & Invariants

- **Pinned Stack Compatibility:** `apps/web` uses `react@18.3.1`, `three@^0.169.0`, `@react-three/fiber@^8.17.10`, and `@react-three/drei@^9.114.3`. `3d-tiles-renderer@^0.5.4` supports `react ^18.3.1`, `three >=0.167.0`, and `@react-three/fiber ^8.17.9` natively.
- **Server-Side Key Hygiene & Google Maps Platform Compliance:**
  - All requests to `tile.googleapis.com`, `geocode.googleapis.com`, `solar.googleapis.com`, and `maps.googleapis.com` happen inside `apps/web/src/app/api/**` with `X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1` and `Cache-Control: no-store`.
  - When Photorealistic 3D Tiles are active, `<TilesAttributionOverlay />` from `3d-tiles-renderer/r3f` MUST be visible in the viewport to display dynamic per-tile copyright & data-provider attributions required by Google Maps Platform ToS.
- **WebGL Drawing Buffer & Logarithmic Depth:** Keep `preserveDrawingBuffer: true` on `<Canvas>` so Gemini multimodal critique captures real `<Bloom>` night renders, and avoid `logarithmicDepthBuffer: true` if `postprocessing` `<Bloom>` conflicts—since `ReorientationPlugin({ recenter: true })` shifts local building tiles right to `(0, 0, 0)` within `[0.2m .. 2500m]` camera `near`/`far`, standard 24-bit depth buffer has sub-millimeter precision without z-fighting!
- **Deterministic Electrical & Balcony Safety Math (`bomMath.ts`):** All NEC 15A/80% (`1,440W`), `210W`/`200 ft` series run, walk-out balcony (`0 ft` railing / `6 ft` soffit), and `4:1 + 3 ft` exterior ladder calculations remain 100% deterministic in TypeScript.

---

## 4. Approaches Considered

1. **Approach 1 (Selected by User): Hybrid Photorealistic 3D Tiles (`3DTilesRendererJS`) + Local Photo/Video 3D (`mps` Depth/Splat) + Full-Bleed Floating-Dock UX**
   - Combines instant real-world 3D buildings from an address via `3d-tiles-renderer/r3f`, optional local photo/video reconstruction on Apple Silicon, instant client-side sample fallback, and a clean `pascalorg/editor`-inspired full-bleed floating-dock studio.
2. **Approach 2: Local Phone-Scan 3D Gaussian Splatting Only (No 3D Map Tiles)**
   - Rejected because typing an address alone (`1007 N Shartel Ave, Oklahoma City, OK`) cannot display the user's building without first filming a full outdoor walkaround.
3. **Approach 3: Pure Parametric CAD Builder (`pascalorg/editor` BIM Only)**
   - Rejected as primary mode because extruded CAD boxes lack the instant visual recognition and accuracy of real photorealistic 3D building tiles (kept as an instant offline fallback & adjustable condo template when Map Tiles API isn't configured).

---

## 5. Detailed Architecture & UX Flow

### 5.1 Scene Source Modes (`SceneSourceMode` in `@lumen3d/shared-schemas` & `useStudioStore`)
Lumen3D supports three unified 3D scene sources inside the exact same `<StudioViewport />` and raycasting pipeline:
1. **`'NONE'` (Landing / Onboarding Mode):**
   - Full-bleed Dusk/Night `<Sky>` + gently rotating architectural ground grid.
   - Centered **Launcher Card** (`data-testid="studio-launcher"`):
     - **Address Form (`<form>`):** Input (`data-testid="input-street-address"`) + **"Load 3D Building"** submit button (`data-testid="btn-lookup-address"`). Submitting calls `POST /api/maps/building-context` + `GET /api/maps/tiles/status`:
       - If Photorealistic 3D Tiles are enabled on `GOOGLE_MAPS_API_KEY` (`status === 200`), transitions immediately into `'MAPS_3D_TILES'` mode centered at `(latitude, longitude, groundElevationMeters)` with `feetPerSceneUnit = 3.28084` (`calibrationSource = 'MAPS_3D_TILES'`).
       - If `GOOGLE_MAPS_API_KEY` lacks Map Tiles API (`403`, e.g., Maps Demo Key) *and* the user also attached photos/video, runs reconstruction merging user media with Maps `displayPolygon` / Solar roof height.
       - *(Google Maps ToS & Builder Call)* If `Map Tiles API` is unavailable (`403` or no key) *and* no photos/video were attached, we strictly honor Google Maps ToS (`AGENTS.md` Invariant #5: never synthesize standalone `.glb` meshes from non-Tile Maps metadata alone without user media). Instead of a cryptic error, the Launcher displays a clear inline card showing the geocoded address status + a 1-line guide to enable **Map Tiles API** on `GOOGLE_MAPS_API_KEY`, alongside buttons to **Attach Facade Photo/Video** or **Open Generic 3-Story Condo Template** immediately.
     - **Upload Dropzone (`data-testid="btn-upload-media"` / `input-upload-files`):** Accepts photos (`.jpg`, `.png`, `.webp`) or walkaround video (`.mp4`, `.mov`), combining with the entered address if present, with a clean 2-option reconstruction mode pill *(Builder Call)*:
       - **`Architectural 3D` (`mode="auto"`, default):** Instant `< 1.5s` editable multi-story/balcony mesh (`ArchitecturalReconstructor`), zero ML weight downloads.
       - **`Neural Depth + 3D Splat (Apple Silicon MPS)` (`mode="da3"`):** Runs `da3_mps_backend.py` on PyTorch `mps`/`cuda`/`cpu` (downloading the compact ~98 MB `depth-anything/Depth-Anything-V2-Small-hf` checkpoint on first explicit `da3` run when `torch` + `transformers` are installed, or gracefully falling back to `ArchitecturalReconstructor` with a warning badge if `torch` is not installed), emitting both `scene.glb` (for raycasting) and `scene.splat` (rendered via `@react-three/drei` `<Splat>`).
     - **Instant Sample Starters:** `Sample 3-Story Condo` (`data-testid="btn-load-sample-condo"`) and `Sample Suburban House` (`data-testid="btn-load-sample-house"`). Calls `/api/reconstruct` if the Python worker is online, and if `/api/reconstruct` fails (`502` / offline worker), **automatically constructs the exact same 3-story 2-balcony condo or 1-story house client-side in Three.js (`proceduralBuilding.ts`)** so the user lands in a working 3D studio in `< 100ms` instead of seeing `"fetch failed"`!
2. **`'MAPS_3D_TILES'` (Live Google Photorealistic 3D Tiles via `3d-tiles-renderer/r3f`):**
   - `apps/web/src/app/api/maps/tiles/[...path]/route.ts` proxies `https://tile.googleapis.com/v1/3dtiles/...`:
     - Replaces dummy client `key` query param with server-side `process.env.GOOGLE_MAPS_API_KEY`.
     - Attaches `X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1` and `Cache-Control: no-store`.
     - For `application/json` tileset manifests, rewrites `"/v1/3dtiles/` URIs to `"/api/maps/tiles/v1/3dtiles/` so nested child `.json` and `.glb` requests stay proxied server-side.
   - `PhotorealisticTilesScene.tsx` mounts `<TilesRenderer url={`${origin}/api/maps/tiles/v1/3dtiles/root.json`}>` with:
     - `GoogleCloudAuthPlugin({ apiToken: 'proxy', autoRefreshToken: true, useRecommendedSettings: true })`
     - `ReorientationPlugin({ lat: degToRad(lat), lon: degToRad(lng), height: groundElevationMeters, recenter: true })`
     - `<TilesAttributionOverlay />` for mandatory Google Maps & data-provider copyright display.
     - Surface normal-aware material classification for live 3D tile raycast hits: upward horizontal hits near ground (`y < 0.8m`) -> `'ground_turf'`; elevated horizontal ledges -> `'asphalt_shingle'`; vertical hits (`|ny| < 0.45`) on upper floors -> `'brick_masonry'` (with 1-click surface tag override in the floating inspector for `'balcony_railing'` / `'balcony_soffit'` / `'metal_gutter'`).
     - Night/Dusk tile dimming: traverses loaded tile `MeshStandardMaterial` / `MeshBasicMaterial` instances and scales color brightness (`1.0` in `DAY`, `0.58` in `DUSK`, `0.26` in `NIGHT`) so daytime aerial photogrammetry looks convincingly lit by moonlight while `<Bloom>` holiday bulbs glow vividly!
3. **`'MESH_RECON'` (Worker `.glb` / `.splat` or Instant Client Procedural Building):**
   - Renders `.glb` via `HouseMesh.tsx`, optional `.splat` overlay via `@react-three/drei` `<Splat>`, or client-built `THREE.Group` from `proceduralBuilding.ts`.

### 5.2 Full-Bleed Spatial Studio Layout (`apps/web/src/app/page.tsx` & Floating Panels)
Once `sceneSource !== 'NONE'`:
- **Viewport (`100vw × 100vh`, `position: fixed inset-0`):**
  - Physical sky (`<Sky>` from `@react-three/drei` in `DAY` and golden-hour `DUSK`; deep indigo starlit dome + fog in `NIGHT`), `<ContactShadows>`, subtle radial `<Grid>` (hidden in `MAPS_3D_TILES` mode since real ground streets/lawns are rendered by the 3D tiles!), and bottom-left `<GizmoHelper>` orientation viewport.
- **Top Floating Bar (`pointer-events-none` row of 3 glass islands):**
  - **Left Island:** `Lumen3D` mark + active building title (`1007 N Shartel Ave` or `3-Story Condo`) + `Change Building` button (reopens Launcher modal) + `Building / Balconies` popover button (`data-testid="btn-toggle-building-adjuster"`, shown when `buildingSpec` exists) + compact `Scale` pill (`1:1 Metric` on Maps 3D Tiles, or `Auto-Calibrate / Ruler` popover `data-testid="calibration-overlay"` on `.glb` meshes).
  - **Center Island:** Segmented **Day · Dusk · Night** switcher (`☀️ Day`, `🌅 Dusk`, `🌙 Night`).
  - **Right Island:** **✨ AI Co-Pilot** button (`data-testid="btn-toggle-copilot"`) and **📋 Shopping List (BOM)** button (`data-testid="btn-toggle-bom"`, with badge count of installed runs). Clicking either slides out a sleek right-hand glass drawer (`CopilotDrawer.tsx`) without permanently stealing screen width.
- **Bottom-Center Floating Dock (`FloatingDock.tsx`):**
  - Clean horizontal dock inspired by `pascalorg/editor`:
    - `1` **Select / Orbit** (`data-testid="tool-select"`)
    - `2` **Roof & Railings** (`data-testid="tool-linear_eave"`)
    - `3` **Wrap Column** (`data-testid="tool-helical_wrap"`)
    - `4` **Bushes** (`data-testid="tool-surface_scatter"`)
    - `5` **Walkway** (`data-testid="tool-pathway_stake"`)
    - Divider + **Bulb & Color Popover Trigger** (shows current bulb icon, spacing `12"`, and active color dots—expands upward when clicked to change `BulbPreset`, `spacingInches`, `Color Palette`, `Pattern`, or selected strand's `SurfaceMaterial` such as `Balcony Railing (No Drill)` / `Balcony Soffit`!)
    - Divider + **Undo / Redo** buttons.
  - Contextual **Active Drawing Pill** floats directly above the dock while placing points: *"Click points along roofline or balcony railing · 3 pts placed"* + **Finish Strand (`Enter`)** (`data-testid="btn-finish-run"`) + **Cancel (`Esc`)**.
- **High-Contrast Obsidian Telemetry Pill (`TelemetryHUD.tsx`):**
  - Compact floating bar (`bg-slate-950/92 text-slate-50 border border-white/15 shadow-2xl backdrop-blur-xl`) showing `Footage`, `Bulbs`, `Watts / Circuits`, and `Max Height / Ladder`—guaranteed high contrast (`> 12:1`) in **Day**, **Dusk**, and **Night** modes alike!

### 5.3 Worker Auto-Bootstrap & Apple Silicon `mps` Support
- `scripts/dev-worker.sh` (invoked by `npm run dev:worker`):
  1. Checks `apps/recon-worker/.venv/bin/python`, `./.venv/bin/python`, `$VIRTUAL_ENV/bin/python`, and `python3` for `import uvicorn, fastapi, trimesh, cv2`.
  2. If no existing environment has the worker packages installed, automatically creates `apps/recon-worker/.venv` and installs `apps/recon-worker` (`pip install -e apps/recon-worker`), printing clear progress instead of exiting with code `127`.
- `apps/recon-worker/app/da3_mps_backend.py`:
  - Optional Apple Silicon (`torch.backends.mps.is_available()`) / CPU monocular-multi-view depth point/mesh unprojection module (`RECON_BACKEND=da3`) when `torch` + `transformers` (`Depth-Anything`) are installed in the Python environment, seamlessly delegating to `ArchitecturalReconstructor` when optional ML weights are not installed.

---

## 6. What's Left to the Builder
- Exact `<Sky>` sun inclination/azimuth parameters for `DAY` vs. `DUSK` and tone-mapping exposure levels so `<Bloom>` LED bulbs remain vivid in Dusk & Night without washing out Day mode.
- Exact surface-normal heuristic thresholds when raycasting arbitrary `3d-tiles-renderer` glTF tile triangles (`ground_turf` vs. `brick_masonry` vs. `asphalt_shingle`), paired with the 1-click surface material selector in the strand inspector.
- Preserving/updating key `data-testid` attributes so both existing and new Vitest + Playwright E2E tests (including Address -> 3D Tiles flow, Condo Balcony BOM flow, and zero-worker client fallback) run fast and deterministically.
