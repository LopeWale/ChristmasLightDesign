# Design Spec: Address-Guided & Photo-Driven 3D Multi-Story Condo Reconstruction

**Date:** 2026-11-20
**Status:** Draft (Pending User Approval)
**Sizing:** Project (Touches `@lumen3d/shared-schemas`, `apps/recon-worker`, `apps/web` API routes & Studio UI, plus real-imagery visual evaluation suite)

---

## 1. Intent & Why

Lumen3D's initial CPU fallback (`SyntheticReconstructor`) ignores uploaded images/videos and always emits the same 1-story suburban gable house. For a resident living in a **3-story condo with two balconies** running on an **8 GB Apple M1 Mac** (without an NVIDIA CUDA GPU):
1. Uploading real condo or home photos/walkaround videos must produce a **genuinely matching, 360°-rotatable 3D building** whose floor count, roof silhouette, facade colors, window bays, and balconies reflect the actual building.
2. Sidewalk phone videos looking steeply upward at a 3-story condo miss true building footprint depth, azimuth, roof height, and rear/side walls. Pairing an optional **street address via Google Maps Platform** with uploaded walkaround photos/video fills in exact metric footprint polygons, building height, roof segments, and Street View facade references.
3. Condo holiday lighting has distinct physical surfaces and HOA constraints: **balcony railings** (metal picket, glass panel, or solid parapet) and **balcony soffits/ceilings** require dedicated surface tagging and non-drilling mounting hardware (UV zip-ties, deck railing clamps, parapet/suction clips) in the BOM.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **Address-to-Footprint & Height Enrichment (Google Maps Platform):** Accept an optional physical street address and query Google Maps Platform server-side to obtain the building's true 2D metric footprint polygon (`displayPolygon`), roof height/pitch (`buildingInsights`), ground elevation, and Street View facade imagery.
- **Photo/Video-Driven Architectural Extraction:** Extract structured `ArchitecturalBuildingSpec` parameters (story count `1..8`, roof style, wall/trim/roof RGB palette from pixels, window bays, entry doors, and multi-floor balcony placements/styles/railings) using **Gemini 2.5 Flash Vision** when `GEMINI_API_KEY` is present, backed by a deterministic **OpenCV Facade Analyzer** (`cv_facade_analyzer.py`) when running offline without API keys.
- **360° Multi-Story & Balcony `.glb` Generator:** Extrude arbitrary convex/concave Maps `displayPolygon` footprints (or photo-inferred rectangular/L-shaped footprints) into watertight, normal-validated multi-story 3D `.glb` collider meshes (`<= 250k` faces, `minY = 0.0`) complete with **cantilevered or recessed balconies**, **3D railings** (`metal_picket`, `glass_panel`, `solid_parapet`), balcony soffits, doors, windows, and roof geometry on all sides so orbiting 360° looks coherent and raycasts cleanly.
- **Interactive Architectural Refine Panel:** Let the user adjust extracted floor count, roof type, and balcony count/floor/face/railing style in the Studio UI and rebuild `scene.glb` in `< 1s` if foliage or camera angle occluded part of a balcony.
- **Balcony Surface Materials & Condo BOM Rules:** Add `'balcony_railing'` and `'balcony_soffit'` to `SurfaceMaterial` with HOA-safe non-penetrating mounting hardware in `bom/route.ts`.
- **Visual Evaluation Across Real Homes & Condos:** Test and visually verify the pipeline end-to-end on real open-licensed multi-story condo (3 floors, multiple balconies), townhome, and pitched-roof house photos/videos, rendering multi-angle 3D rotation & night-bloom screenshots.

### Non-Goals
- Full city-block neighbor building generation (focus strictly on the target building + immediate ground/walkway apron).
- Interior room modeling behind condo windows/balcony doors.

### Anti-Goals (Failure Conditions Even If Technically Working)
- Returning a hardcoded 1-story house when a user uploads a 3-story condo photo/video.
- Requiring > 4 GB RAM or a CUDA GPU on an 8 GB M1 Mac.
- Violating Google Maps Platform Terms of Service (never scrape/export Google Photorealistic 3D Tiles to `.glb`, never mix Google Maps data with non-Google map providers like OpenStreetMap, never cache Maps payloads > 30 days, and never use Maps data for ML training).

---

## 3. Approaches Considered

| Approach | Summary | Trade-offs | Decision |
| :--- | :--- | :--- | :--- |
| **1. Maps Footprint + Gemini/CV Photo-to-3D Architectural Builder** | Fuse Google Maps Geocoding v4 `displayPolygon` + Solar `buildingInsights` + Street View with Gemini Vision / OpenCV keyframe extraction to synthesize a clean, rotatable multi-story `.glb` with crisp 3D balconies & railings. | Crisp raycastable balcony rails/soffits, fast (`< 2s`), low memory on 8 GB M1, works with or without keys, 100% ToS-compliant. Parametric rather than raw photogrammetry millimetric stone texture. | **Selected by User** |
| **2. Live Google Photorealistic 3D Tiles (`Map Tiles API`)** | Stream Google's OGC 3D Tiles aerial mesh directly into Three.js. | Instant neighborhood context, but aerial photogrammetry blobs/melts recessed condo balconies under overhangs, requires live API session to view, and cannot be exported offline per ToS. | Rejected |
| **3. Local Neural Multi-View (`VGGT-1B` on CPU/MPS)** | Run dense neural depth on sidewalk video frames alone. | Exceeds comfortable 8 GB unified RAM budget alongside Next.js/Chrome and leaves gaping holes on upper condo roofs, side walls, and unseen rear facades. (Retained as optional `RECON_BACKEND=vggt` on CUDA machines.) | Rejected as primary condo flow |

---

## 4. Technical Architecture

### 4.1 Shared Contracts (`packages/shared-schemas/src/index.ts`)
1. Extend `SurfaceMaterialSchema` with `'balcony_railing'` and `'balcony_soffit'`.
2. Add `BalconySpecSchema`:
   - `id: string`
   - `floor: number` (`1..8`, where `1` is ground floor, `2` is 2nd floor, `3` is 3rd floor)
   - `wallFace: 'front' | 'left' | 'right' | 'rear'`
   - `centerOffsetNorm: number` (`-0.35 .. +0.35` along that facade wall)
   - `widthMeters: number` (default `3.2`)
   - `depthMeters: number` (default `1.4`)
   - `mountStyle: 'cantilevered' | 'recessed'`
   - `railingType: 'metal_picket' | 'glass_panel' | 'solid_parapet'`
3. Add `ArchitecturalBuildingSpecSchema`:
   - `archetype: 'multi_story_condo' | 'townhouse' | 'single_family_gable' | 'modern_box'`
   - `floors: number` (`1..8`, floor-to-floor height `metersPerFloor` default `3.05m` / `10 ft`)
   - `footprintPolygonMeters: Array<[number, number]>` (CCW 2D `[x, z]` vertices in local meters centered at origin, front street-facing edge aligned toward `+Z`; defaults to `[[-6, -5], [6, -5], [6, 5], [-6, 5]]` when no polygon is supplied)
   - `roofStyle: 'flat_parapet' | 'pitched_gable' | 'hip'`
   - `roofPitchDegrees: number` (`0..45`)
   - `wallColorRgb: [number, number, number]`
   - `trimColorRgb: [number, number, number]`
   - `roofColorRgb: [number, number, number]`
   - `windowBaysPerFloor: number` (`1..8`)
   - `hasGarage: boolean`
   - `balconies: BalconySpec[]`
   - `sourceSummary: string` (e.g., `"Google Maps footprint + Gemini 3-story condo extraction"` or `"OpenCV multi-view facade analysis"`)

### 4.2 Google Maps Platform Enrichment (`apps/web/src/app/api/maps/building-context/route.ts`)
- **Authentication & Security:** Uses server-side `GOOGLE_MAPS_API_KEY` loaded from root `.env` or `apps/web/.env` (never exposed to browser client; avoids CORS Trap CF1). Supports both standard Google Cloud API keys and the zero-billing **Google Maps Demo Key** (degrading gracefully if Solar API returns `403`/`404` on a Demo Key or uncovered region).
- **Mandatory Header & Attribution:** All outbound Google Maps REST calls include header `X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1`. UI displays Google Maps attribution and Street View copyright metadata when Maps context is loaded, with zero permanent disk caching (`Cache-Control: no-store`).
- **Pipeline for `POST /api/maps/building-context` (`{ address: string }`):**
  1. **Geocoding API v4 (`POST https://geocode.googleapis.com/v4/geocode/destinations`):** Requests `destinations.primary.place,destinations.primary.formattedAddress,destinations.primary.location,destinations.primary.structureType,destinations.primary.displayPolygon`. Converts GeoJSON `displayPolygon` ring `(lng, lat)` into metric local `(x, z)` meters via equirectangular tangent projection centered at polygon centroid. If `displayPolygon` is unavailable, falls back to classic Geocoding `https://maps.googleapis.com/maps/api/geocode/json` coordinates.
  2. **Street View Metadata (`GET https://maps.googleapis.com/maps/api/streetview/metadata`):** Finds nearest street camera `(panoLat, panoLng)` and computes exact compass bearing from street camera to building centroid! Uses that vector to **rotate the local `(x, z)` footprint polygon** so the street-facing wall always faces `+Z` (matching Camera `0` and user sidewalk photos!). Also fetches a `640x480` Street View Static facade image (`pitch=12`, `fov=75`) in memory for Gemini/CV facade analysis.
  3. **Solar API (`GET https://solar.googleapis.com/v1/buildingInsights:findClosest` + Elevation API):** When available, reads `roofSegmentStats` (`pitchDegrees`, `planeHeightAtCenterMeters`) and ground elevation to estimate metric building roof height `H_building` -> `estimatedFloors = clamp(round(H_building / 3.1), 1, 8)` and `roofStyle` (`pitchDegrees < 6` -> `'flat_parapet'`, else `'pitched_gable'`).

### 4.3 Gemini + OpenCV Architectural Extractor
1. **`POST /api/reconstruct` Orchestration (`apps/web/src/app/api/reconstruct/route.ts`):**
   - Accepts multipart `files` (photos or `.mp4`/`.mov` walkaround video), optional `address: string`, and optional explicit `buildingSpecJson: string` (when user edits sliders in the Refine panel, or clicks **"Load 3-Story Condo Preset"** vs **"Load Classic House Preset"**).
   - If `address` is provided and `GOOGLE_MAPS_API_KEY` is configured, fetches `MapsBuildingContext` (footprint polygon, street-facing rotation, estimated height/roof pitch, Street View image).
   - If `GEMINI_API_KEY` is configured (and not `GEMINI_MOCK_MODE=true`), passes up to 4 uploaded photo/video frames + optional Street View image + Maps height/footprint hints to `gemini-2.5-flash` with a strict `responseSchema` returning `ArchitecturalBuildingSpec`.
   - Forwards `files` + optional `spec_json` (containing Maps footprint/height and/or Gemini spec) to `apps/recon-worker` `POST /jobs/reconstruct`.
2. **OpenCV Multi-View Facade Analyzer (`apps/recon-worker/app/cv_facade_analyzer.py`):**
   - Whenever `recon-worker` receives real images/video frames without a complete `ArchitecturalBuildingSpec` (e.g., before `GEMINI_API_KEY` is added to `.env`), `cv_facade_analyzer.py` analyzes the actual pixels of the uploaded images/keyframes instead of returning a static house:
     - Segments sky vs facade foreground, measures building aspect ratio (`height / width`) and upper-edge roof slope (`flat_parapet` vs `pitched_gable`).
     - Samples real median facade wall RGB, trim RGB, and roof/parapet RGB directly from the facade regions.
     - Detects horizontal floor-band / balcony-slab periodic edges (Sobel-Y projection peaks) and dark window/recessed-balcony openings to infer `floors` (`1..6`), `windowBaysPerFloor`, and `balconies[]` (e.g., 2nd & 3rd floor balconies when horizontal slab/railing bands appear)!
     - Merges any Maps `footprintPolygonMeters` / `estimatedFloors` if provided.

### 4.4 360° Multi-Story & Balcony Mesh Builder (`apps/recon-worker/app/architectural_backend.py`)
- Replaces the static single-house limitation in `auto`/`architectural` mode (while preserving the original 1-story house as `"Sample Suburban House"` AND adding `"Sample 3-Story Condo (2 Balconies)"` for instant 1-click demo!).
- Given any `ArchitecturalBuildingSpec`:
  - **2D Polygon Extrusion:** Extrudes `footprintPolygonMeters` from `y = 0.02` to `H = floors * metersPerFloor` with crisp unmerged wall normals on all 360° sides (front, left, right, rear) + floor belt-courses between stories.
  - **Roof:** Generates a `flat_parapet` perimeter coping wall + recessed membrane roof (for condos/modern homes) OR pitched gable roof matching footprint bounds.
  - **Balconies (`balcony_railing` & `balcony_soffit`):** For each `BalconySpec` on its target floor (`y_floor = (floor - 1) * metersPerFloor`) and wall face (`front`, `left`, `right`, `rear`):
    - Builds structural floor slab (`y_floor` to `y_floor + 0.18m`), under-balcony ceiling soffit (`balcony_soffit` — ideal for `RGB_SOFFIT_PUCK` or icicles!), sliding glass balcony doors (`2.033m = 6.67 ft`), and a `1.07m` (`42"` IBC code height!) 3D perimeter railing (`balcony_railing`):
      - `'metal_picket'`: top rail, bottom rail, corner posts, and vertical balusters!
      - `'glass_panel'`: metal top/bottom rails + tinted architectural glass panels!
      - `'solid_parapet'`: solid stucco/concrete half-wall + coping cap!
  - **Entry Door, Windows, Shrubs & Surrounding Ground:** Places a metric `6.67 ft` (`2.033m`) primary ground-floor entry door (`front_door`) on the `+Z` street wall so Gate 2 door calibration works seamlessly across both houses and condos, populates multi-story window grids on all 4 facades so rotating 360° looks complete, and generates multi-angle `cameras.json` (`front`, `front_left`, `right_side`, `rear_oblique` scaled automatically to building bounding sphere!) + `reference_front.png`.

### 4.5 Studio UI Upgrades (`apps/web`)
1. **Header / Upload Modal / Refine Drawer:**
   - Address input field (`Street Address — Optional Google Maps 3D Footprint & Height`) alongside photo/video file upload.
   - Sample selector offering both **Sample 3-Story Condo (2 Balconies)** and **Sample Suburban House**.
   - Collapsible **3D Building & Balcony Adjuster** section in left panel: live controls for `Floors (1–6)`, `Roof Style`, and `Balconies` (add/remove balcony, floor `2`/`3`, face `front`/`left`/`right`, railing `metal_picket`/`glass_panel`/`solid_parapet`) with **"Rebuild 3D Mesh"** button so users can tweak any occluded balcony in `< 1s`.
   - Automatic OrbitControls camera framing (`fitCameraToSceneBounds`) so tall 3-story condos and wide houses both frame cleanly and rotate smoothly 360° around the building centroid.

---

## 5. Builder Calls Made (Open for User Review)
- **Default Condo Demo Preset:** Added a 1-click **"3-Story Condo (2 Balconies)"** preset (3 floors, flat parapet roof, warm contemporary brick/stone facade, 2nd-floor and 3rd-floor balconies with `42"` metal picket railings & sliding glass doors) alongside the existing 1-story house so you can test balcony lighting immediately even before uploading your own video.
- **Address Enriches User Media (Never Maps-Only `.glb` Scraping):** Custom reconstructions require at least one user-uploaded photo or walkaround video, with the street address acting as optional Google Maps enrichment (`displayPolygon` footprint + Solar roof height + Street View angle alignment). Generating downloadable `.glb` meshes solely from Google Maps content without user media is intentionally disallowed to honor Google Maps Platform derived-content Terms of Service.
- **Walk-Out Balcony Ladder & Safety Math (`bomMath.ts`):** Runs placed on `'balcony_railing'` (`0 ft` ladder — installed safely from inside the walk-out balcony deck) and `'balcony_soffit'` (`6 ft` step-ladder on the balcony deck) are excluded from ground-up exterior extension-ladder sizing. Exterior facade/roof runs keep the exact `4:1 + 3 ft` ground-referenced ladder formula, plus a safety warning whenever an exterior roof run exceeds a `40 ft` residential extension ladder (recommending professional rope/lift access).
- **Dual-Mode `RECON_BACKEND` Precedence:** On CPU/Apple Silicon (`RECON_BACKEND=auto`) or whenever an `address` / `ArchitecturalBuildingSpec` is supplied, reconstruction uses the new `ArchitecturalReconstructor` (enabling the `< 1s` **3D Building & Balcony Adjuster**). Explicit `RECON_BACKEND=vggt` on CUDA machines continues to run neural `VGGT + Open3D` TSDF fusion (hiding the parametric adjuster when `backendUsed === 'vggt'`).
- **No-Key Graceful Degradation:** `GOOGLE_MAPS_API_KEY` is optional in `.env` (alongside `GEMINI_API_KEY`). Without `GOOGLE_MAPS_API_KEY`, uploaded photos/videos still reconstruct multi-story condos via Gemini Vision (if `GEMINI_API_KEY` is set) or local OpenCV facade analysis (`cv_facade_analyzer.py`).
- **HOA-Friendly Balcony BOM Hardware:** `balcony_railing` maps to UV-stabilized nylon zip-ties & non-marring deck railing clamps, and `balcony_soffit` maps to outdoor Command/3M VHB adhesive clips (zero drilling into condo concrete/stucco).

---

## 6. What's Left to the Builder
- Exact OpenCV Sobel/color clustering thresholds in `cv_facade_analyzer.py` tuned against real multi-story condo & house test photos.
- Polygon winding normalization (ensuring CCW vertex order for arbitrary Geocoding `displayPolygon` rings).
- Camera bounding-sphere distance math so `reference_front.png` and R3F `OrbitControls` frame buildings of any height (`1..8` stories).
