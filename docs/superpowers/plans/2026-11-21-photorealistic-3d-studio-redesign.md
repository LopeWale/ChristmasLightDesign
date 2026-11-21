# Photorealistic 3D Tiles, Apple Silicon Splat/Depth & Spatial Studio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Lumen3D around 2026 open-source 3D spatial rendering (`NASA-AMMOS/3DTilesRendererJS` Photorealistic 3D Tiles, Apple Silicon `mps` depth/splat reconstruction with `@react-three/drei` `<Splat>`, instant client-side fallback, and a `pascalorg/editor`-style full-bleed floating-dock UI) with zero-failure `npm run dev` startup.

**Architecture:** `apps/web` streams live Google Photorealistic 3D Tiles via `3d-tiles-renderer/r3f` (`GoogleCloudAuthPlugin` + `ReorientationPlugin` + `<TilesAttributionOverlay />`) through a server-side `/api/maps/tiles/[...path]` proxy that hides `GOOGLE_MAPS_API_KEY` and rewrites child tile URIs, while `proceduralBuilding.ts` provides `< 50ms` in-browser condo/house fallback whenever `recon-worker` is unreachable. The UI transitions from a sidebar-free centered Launcher Card (`sceneSource === 'NONE'`) into a 100% full-bleed `<Sky>`-lit 3D viewport with floating glass islands, a bottom tool dock, high-contrast dark obsidian telemetry, and on-demand slide-over Co-Pilot/BOM drawers. `scripts/dev-worker.sh` auto-bootstraps `.venv` and `apps/recon-worker/app/da3_mps_backend.py` adds PyTorch `mps`/`cuda`/`cpu` depth + `.splat` generation.

**Tech Stack:** TypeScript, Next.js 14 App Router, React 18, Three.js `0.169`, `@react-three/fiber`, `@react-three/drei` (`Sky`, `Splat`, `ContactShadows`, `Grid`, `GizmoHelper`), `3d-tiles-renderer@^0.5.4`, Zustand, Tailwind CSS, `@google/genai`, Python 3.12, FastAPI, `trimesh`, OpenCV, optional PyTorch `mps` + `transformers`, Vitest, Pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-photorealistic-3d-studio-redesign.md`

## Global Constraints

- Keep `GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY` strictly server-side inside `apps/web/src/app/api/**`; never expose keys via `NEXT_PUBLIC_*`.
- Include `X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1` and `Cache-Control: no-store` on all outbound Google Maps REST and Map Tiles requests; display `<TilesAttributionOverlay />` when Photorealistic 3D Tiles are active; never export Google 3D Tiles to downloadable `.glb` files, and never synthesize standalone `.glb` meshes from non-Tile Maps metadata alone without user media.
- Keep `<Canvas gl={{ preserveDrawingBuffer: true, antialias: true }}>` without `logarithmicDepthBuffer` so `@react-three/postprocessing` `<Bloom>` and `toDataURL('image/png')` work together cleanly.
- Initial landing state (`sceneSource === 'NONE'`) must show **zero** left/right toolbars and **zero** `0.0 ft` telemetry HUDs.
- All floating HUDs/pills must use high-contrast dark glass (`bg-slate-950/90+`, light text) so text remains clearly legible (`> 12:1` contrast) in bright `DAY` sky mode as well as `DUSK` and `NIGHT`.

## Review Focus

1. **`GoogleCloudAuth` URL resolution & root-relative child tile URIs in `/api/maps/tiles/[...path]`:** `GoogleCloudAuth` calls `new URL(this.authURL)` (requiring an absolute `${origin}/api/maps/tiles/v1/3dtiles/root.json` URL) and Google's tileset JSON contains root-relative `"/v1/3dtiles/datasets/..."` URIs that bypass `/api/maps/tiles` unless rewritten in JSON manifests while leaving binary `.glb` arrayBuffers untouched (tested in Task 2).
2. **`npm run dev` with an active root `(.venv)` or fresh clone lacking `apps/recon-worker/.venv`:** `scripts/dev-worker.sh` must probe candidate Python interpreters for `uvicorn, fastapi, trimesh, cv2` before falling back to auto-creating `apps/recon-worker/.venv`, and sample presets must still load in-browser (`proceduralBuilding.ts`) if `/api/reconstruct` returns `502` (tested in Tasks 1 & 4).
3. **Raycasting unnamed Google 3D Tile triangles vs. named `.glb` house meshes:** Live 3D Tile glTF primitives have arbitrary numeric node names; `classifyHitSurfaceMaterial` must fall back to world-normal & local-elevation heuristics (`y < 0.8` upward -> `'ground_turf'`, elevated upward -> `'asphalt_shingle'`, vertical -> `'brick_masonry'`) while preserving name-based tagging for `balcony_railing`, `balcony_soffit`, `column`, `shrub`, and `gutter` (tested in Task 3).
4. **Address-only submit when `Map Tiles API` returns `403` (Demo Key) or `GOOGLE_MAPS_API_KEY` is unset:** Submitting `1007 N Shartel Ave, Oklahoma City, OK` without photos must not show `"fetch failed"` and must not violate Maps ToS by building a `.glb` from non-Tile metadata alone—it must surface an actionable Map Tiles setup guide with 1-click Condo template & photo-attach actions (tested in Tasks 2 & 5).
5. **Day-mode `<Sky>` washing out `TelemetryHUD` or hiding slide-over drawers:** Switching to `DAY` mode must render a physical sky shader while keeping `TelemetryHUD` dark-backed (`rgb` background luminance `< 25`) and keeping `CopilotDrawer` closed until explicitly toggled (tested in Task 5).

---

### Task 1: Shared Schemas, Auto-Bootstrapping Worker Script & Apple Silicon `da3` Backend

**Files:**
- Modify: `packages/shared-schemas/src/index.ts`
- Modify: `packages/shared-schemas/tests/schemas.test.ts`
- Create: `scripts/dev-worker.sh`
- Modify: `package.json`
- Create: `apps/recon-worker/app/da3_mps_backend.py`
- Modify: `apps/recon-worker/app/schemas.py`
- Modify: `apps/recon-worker/app/reconstructor.py`
- Modify: `apps/recon-worker/app/main.py`
- Modify: `apps/web/src/app/api/reconstruct/route.ts`
- Create: `apps/recon-worker/tests/test_da3_and_bootstrap.py`

**Interfaces:**
- Produces:
  - `CalibrationSourceSchema`: adds `'MAPS_3D_TILES'`
  - `SceneSourceModeSchema`: `'NONE' | 'MAPS_3D_TILES' | 'MESH_RECON'`
  - `ReconstructionModeSchema` & `backendUsed`: adds `'da3'`
  - `ReconstructionJob.splatUrl?: string`
  - `MapsBuildingContext.groundElevationMeters: number | null`
  - `DA3MpsReconstructor.reconstruct(input_images: list[Path], output_dir: Path) -> ReconstructionResult` (emits `scene.glb`, `scene.splat`, `cameras.json`, `reference_front.png`)

- [ ] **Step 1: Write failing schema & Python `da3`/bootstrap tests**
- [ ] **Step 2: Run tests to verify RED failure**
- [ ] **Step 3: Implement schema additions, `scripts/dev-worker.sh`, and `da3_mps_backend.py`**
- [ ] **Step 4: Rebuild `@lumen3d/shared-schemas` and verify Vitest + Pytest GREEN**
- [ ] **Step 5: Commit**

---

### Task 2: Server-Side Google Photorealistic 3D Tiles Proxy & Status API

**Files:**
- Modify: `apps/web/src/lib/maps/buildingContext.ts`
- Create: `apps/web/src/lib/maps/tilesProxy.ts`
- Create: `apps/web/src/app/api/maps/tiles/status/route.ts`
- Create: `apps/web/src/app/api/maps/tiles/[...path]/route.ts`
- Create: `apps/web/tests/tilesProxy.test.ts`

**Interfaces:**
- Consumes: `MapsBuildingContext` (`groundElevationMeters`), `GMP_SOLUTION_ID`
- Produces:
  - `rewriteTilesetJsonUris(jsonText: string): string`
  - `proxyGoogle3DTilesRequest(subPath: string[], incomingSearchParams: URLSearchParams, apiKey: string, fetchImpl?: typeof fetch): Promise<Response>`
  - `checkGoogle3DTilesAvailability(apiKey: string | undefined, fetchImpl?: typeof fetch): Promise<{ available: boolean; status: number; reason?: string }>`
  - `GET /api/maps/tiles/status` & `GET /api/maps/tiles/[...path]`

- [ ] **Step 1: Write failing `tilesProxy.test.ts` covering key stripping, header injection, JSON URI rewriting, binary `.glb` passthrough, and `403` status check**
- [ ] **Step 2: Run `npx vitest run apps/web/tests/tilesProxy.test.ts` to verify RED**
- [ ] **Step 3: Implement `tilesProxy.ts`, `/api/maps/tiles/status/route.ts`, `/api/maps/tiles/[...path]/route.ts`, and `groundElevationMeters` in `buildingContext.ts`**
- [ ] **Step 4: Run `npm test` to verify GREEN**
- [ ] **Step 5: Commit**

---

### Task 3: `3d-tiles-renderer` Integration, Instant Client Procedural Building & Physical Sky Viewport

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/lib/geometry/proceduralBuilding.ts`
- Create: `apps/web/src/components/canvas/PhotorealisticTilesScene.tsx`
- Modify: `apps/web/src/components/canvas/HouseMesh.tsx`
- Modify: `apps/web/src/components/canvas/StudioViewport.tsx`
- Modify: `apps/web/src/store/useStudioStore.ts`
- Create: `apps/web/tests/proceduralAndTiles.test.ts`

**Interfaces:**
- Consumes: `SceneSourceMode`, `CalibrationSource` (`'MAPS_3D_TILES'`), `/api/maps/tiles/v1/3dtiles/root.json`
- Produces:
  - `buildClientProceduralBuilding(preset: 'condo' | 'house'): { group: THREE.Group; cameras: CameraPose[]; minY: number; spec: ArchitecturalBuildingSpec }`
  - `classifyHitSurfaceMaterial(objectName: string, localPoint: THREE.Vector3, worldNormal: THREE.Vector3): SurfaceMaterial`
  - `useStudioStore` fields: `sceneSource`, `sceneTitle`, `tilesAnchor`, `proceduralPreset`, `activeDrawer`, `setTilesScene`, `setProceduralScene`, `resetToLauncher`, `setActiveDrawer`

- [ ] **Step 1: Install `3d-tiles-renderer@^0.5.4` and write failing `proceduralAndTiles.test.ts`**
- [ ] **Step 2: Run `npx vitest run apps/web/tests/proceduralAndTiles.test.ts` to verify RED**
- [ ] **Step 3: Implement `proceduralBuilding.ts`, `PhotorealisticTilesScene.tsx`, `useStudioStore.ts` scene source state, and `StudioViewport.tsx` physical `<Sky>` + `<Splat>` + unified raycasting**
- [ ] **Step 4: Run `npm test && npm run typecheck` to verify GREEN**
- [ ] **Step 5: Commit**

---

### Task 4: Full-Bleed Progressive Studio UI (`StudioLauncher`, `FloatingDock`, Obsidian `TelemetryHUD`, Slide-Over `CopilotDrawer`)

**Files:**
- Create: `apps/web/src/components/panels/StudioLauncher.tsx`
- Create: `apps/web/src/components/panels/FloatingDock.tsx`
- Modify: `apps/web/src/components/panels/TelemetryHUD.tsx`
- Modify: `apps/web/src/components/panels/CopilotDrawer.tsx`
- Modify: `apps/web/src/components/panels/BuildingAdjuster.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/tests/studioStoreAndFlow.test.ts`

**Interfaces:**
- Consumes: `useStudioStore` (`sceneSource`, `activeDrawer`, `setTilesScene`, `setProceduralScene`, `resetToLauncher`), `/api/maps/building-context`, `/api/maps/tiles/status`, `/api/reconstruct`
- Produces:
  - `resolveAddressLaunchAction(address: string, fetchImpl?: typeof fetch)` helper & `<StudioLauncher />`, `<FloatingDock />`, slide-over `<CopilotDrawer />`, high-contrast `<TelemetryHUD />`, and full-bleed `HomePage`

- [ ] **Step 1: Write failing `studioStoreAndFlow.test.ts` testing address -> 3D Tiles transition, `403` Map Tiles ToS-safe guide state, and `502` worker offline -> client procedural Condo fallback**
- [ ] **Step 2: Run `npx vitest run apps/web/tests/studioStoreAndFlow.test.ts` to verify RED**
- [ ] **Step 3: Implement `StudioLauncher.tsx`, `FloatingDock.tsx`, `TelemetryHUD.tsx`, `CopilotDrawer.tsx`, `BuildingAdjuster.tsx`, and `page.tsx`**
- [ ] **Step 4: Run `npm test && npm run typecheck` to verify GREEN**
- [ ] **Step 5: Commit**

---

### Task 5: Playwright E2E, Multi-Mode Visual Screenshot Inspection & Docs

**Files:**
- Modify: `apps/web/tests/studio.spec.ts`
- Modify: `.env.example`
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: All redesigned UI `data-testid` hooks, `StudioLauncher`, `FloatingDock`, `CopilotDrawer`, `TelemetryHUD`

- [ ] **Step 1: Update `apps/web/tests/studio.spec.ts` covering sidebar-free Landing, House & 3-Story Condo flows with FloatingDock & Slide-Over Drawers, Address Lookup flow, and Day-mode dark HUD contrast**
- [ ] **Step 2: Update `.env.example`, `AGENTS.md`, and `README.md` for Map Tiles API, `scripts/dev-worker.sh`, and `RECON_BACKEND=da3`**
- [ ] **Step 3: Run `npm run build && npm run test:e2e` and full Python/TS suites**
- [ ] **Step 4: Capture high-DPI Chromium screenshots of Landing, Day Condo + HUD, Dusk Bulb Popover, and Night-Bloom + AI Co-Pilot Drawer, and visually inspect every image via `read_file`**
- [ ] **Step 5: Commit**
