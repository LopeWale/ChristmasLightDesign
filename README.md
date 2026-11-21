# Lumen3D — Spatial 3D Building & Holiday Lighting Studio

**Lumen3D** is a modern full-bleed 3D exterior holiday lighting studio built on **React Three Fiber**, **`NASA-AMMOS/3DTilesRendererJS`** (streaming live **Google Photorealistic 3D Tiles** centered in local metric coordinates), **Apple Silicon `mps` / multi-view depth + 3D Gaussian Splatting (`@react-three/drei` `<Splat>`)**, deterministic NEC electrical & walk-out balcony safety math, and **Google Gemini (`@google/genai`)** visual critique & HOA-friendly Bill of Materials (BOM) generation.

---

## Key Capabilities

1. **Stream Your Real Building by Street Address (`3d-tiles-renderer/r3f`):**
   - Enter any address (e.g., `1007 N Shartel Ave, Oklahoma City, OK`) and press **Enter** to stream **Google Photorealistic 3D Tiles** through a private server-side Next.js proxy (`/api/maps/tiles/[...path]`), centered at `(0, 0, 0)` in `1:1` meters (`3.28084 ft/unit`) via `ReorientationPlugin` with Dusk/Night architectural dimming and direct click-to-string raycasting.
2. **Phone Walkaround Photo/Video Reconstruction (`Architectural 3D` + `Apple Silicon MPS Depth + Splat`):**
   - Drop condo or home walkaround photos/videos to build a 360° rotatable 3D building with cantilevered/recessed balconies (`mode="auto"`) or dense `.splat` + `.glb` depth reconstruction (`mode="da3"`).
3. **Full-Bleed Progressive Spatial Studio (`pascalorg/editor`-inspired UX):**
   - Opens to a clean, sidebar-free 3D sky launcher; once a building is loaded, provides a floating bottom dock (`1` *Select*, `2` *Roof & Railings*, `3` *Wrap Column*, `4` *Bushes*, `5` *Walkway*), physical `<Sky>` atmosphere (*Day · Dusk · Night*), high-contrast dark obsidian telemetry, and on-demand slide-over drawers for **AI Co-Pilot** and **Shopping List (BOM)**.
4. **Zero-Failure One-Command Startup (`npm run dev`):**
   - `scripts/dev-worker.sh` automatically detects your active Python virtualenv or bootstraps `apps/recon-worker/.venv` on first run, and sample condo/house presets include an instant `< 50ms` in-browser Three.js fallback if the worker is offline.

---

## Quickstart

### 1. Configure `.env`
```bash
cp .env.example .env
```

Set your server-side keys in `.env` (never prefixed with `NEXT_PUBLIC_`):
```dotenv
GEMINI_API_KEY=your_real_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
RECON_BACKEND=auto
RECON_WORKER_URL=http://127.0.0.1:8001
```

#### Enabling Photorealistic 3D Tiles on `GOOGLE_MAPS_API_KEY`
- In the [Google Cloud Console Credentials Page](https://console.cloud.google.com/google/maps-apis/credentials?utm_campaign=gmp_git_agentskills_v1), enable **Map Tiles API**, **Geocoding API**, **Maps Elevation API**, **Solar API**, and **Street View Static API**, and apply IP/API restrictions per [Google Cloud API Key Restrictions](https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys?utm_campaign=gmp_git_agentskills_v1).
- For zero-cost address prototyping without Map Tiles API, you can also generate a [Google Maps Demo Key](https://mapsplatform.google.com/maps-demo-key?utm_campaign=gmp_git_agentskills_v1) and pair your address with uploaded facade photos/video.
- Usage of Google Maps Platform services may incur costs against your Google Cloud billing account and is governed by the [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms?utm_campaign=gmp_git_agentskills_v1).

### 2. Install & Run
```bash
npm install
npm run dev
```
*(On first run, `scripts/dev-worker.sh` automatically sets up `apps/recon-worker/.venv` if needed.)*

Open **http://localhost:3000**.

*(Optional — Apple Silicon Neural Depth)* To run `Depth-Anything` natively on Apple Silicon `mps`:
```bash
apps/recon-worker/.venv/bin/pip install torch transformers
```

---

## Verification & Test Suite

```bash
npm run test:python
npm test
npm run typecheck
npm run build
npm run test:e2e
```
