# Lumen3D — 3D Exterior Reconstruction & Holiday Lighting Studio

**Lumen3D** is a full-stack monorepo studio that reconstructs multi-view building photos or walkaround videos into a metric-calibrated 3D collider mesh, renders multi-orientation holiday light designs (`C9`, `C7`, `5mm Mini`, `Icicle Drops`, `RGB Soffit Pucks`, `Pathway Stakes`) with night-bloom post-processing, computes deterministic wire footage, NEC electrical loads & 4:1 ladder sizing, and pairs with Google Gemini (`@google/genai`) for spatial auto-calibration, visual night-render critique, interactive concept presets, and contractor-grade Bills of Materials (BOM).

---

## Architecture Overview

```text
lumen3d/
├── AGENTS.md                        # Persistent architecture invariants, ports, & gate status
├── README.md                        # Setup & one-command run instructions (GPU & Synthetic)
├── .env.example                     # Server-side environment template
├── packages/
│   └── shared-schemas/              # Strict TypeScript + Zod contracts (@lumen3d/shared-schemas)
└── apps/
    ├── recon-worker/                # FastAPI 3D reconstruction worker (port 8001)
    │   └── app/                     # VGGT + Open3D ScalableTSDFVolume & Synthetic house backends
    └── web/                         # Next.js 14 App Router + React Three Fiber Studio (port 3000)
```

### Key Guardrails
- **Multi-View Scene Reconstruction Only:** Uses `facebookresearch/vggt` + `Open3D` `ScalableTSDFVolume` (`RECON_BACKEND=vggt`) or a deterministic multi-part metric house mesh (`RECON_BACKEND=synthetic`, auto-selected when CUDA is absent via `RECON_BACKEND=auto`).
- **Deterministic Math First, LLM Second:** Exact 3D polyline/helical arc-lengths (ft), bulb counts, wattages, NEC 15A/80% (`1,440W`) continuous GFCI loads, `210W` / `200 ft` series warnings, and OSHA 4:1 + 3ft ladder sizing are computed purely in TypeScript (`bomMath.ts`) before passing `DesignTelemetry` to Gemini.
- **Server-Side `@google/genai` Only:** Uses the official `@google/genai` SDK (`gemini-2.5-flash` by default) exclusively inside Next.js API routes. `GEMINI_API_KEY` is never exposed to browser bundles.

---

## Prerequisites

- **Node.js** `20+` and **npm** `10+`
- **Python** `3.11+` (e.g., Python `3.12`)
- **Google Gemini API Key** (`GEMINI_API_KEY`)

---

## Setup

### 1. Configure `.env`
Copy `.env.example` to `.env` in the cloned repository root (Lumen3D automatically loads `.env` from the repository root as well as `apps/web/.env`):

```bash
cp .env.example .env
```

Edit `.env` and set your Gemini API key:

```dotenv
GEMINI_API_KEY=your_real_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
RECON_BACKEND=auto
RECON_WORKER_URL=http://127.0.0.1:8001
```

### 2. Install Node & Python Dependencies

```bash
# Install npm workspace packages
npm install

# Create Python 3.11+ virtual environment & install recon-worker
python3.12 -m venv apps/recon-worker/.venv
apps/recon-worker/.venv/bin/pip install -e "apps/recon-worker[dev]"
```

*(Optional — GPU VGGT Mode)* On an NVIDIA CUDA workstation, install PyTorch, Open3D, and VGGT into `apps/recon-worker/.venv`:

```bash
apps/recon-worker/.venv/bin/pip install torch torchvision open3d git+https://github.com/facebookresearch/vggt.git
```

---

## One-Command Startup

### Standard / Auto Mode (Uses CUDA `vggt` if available, else `synthetic`)
```bash
npm run dev
```
- **Web Studio:** http://localhost:3000
- **3D Recon Worker:** http://127.0.0.1:8001/health

### Explicit Synthetic Mode (Instant CPU / Demo Mode)
```bash
RECON_BACKEND=synthetic npm run dev
```

### Explicit GPU VGGT Mode
```bash
RECON_BACKEND=vggt npm run dev
```

---

## Studio Workflow

1. **Load or Upload Facade:** Click **Load Sample House** for an instant metric-consistent 3D residential facade, or **Upload Photos / Video** (`.jpg`, `.png`, `.webp`, `.mp4`, `.mov`).
2. **Spatial Scale Calibration:** Click **Auto-Calibrate (Gemini)** to detect the front door (`6.67 ft`) or garage door (`7.00 ft`) and back-project 3D rays onto `scene.glb`, or click **2-Click Ruler** to measure any known span manually.
3. **3D Multi-Orientation Light Design:**
   - **Linear / Eave:** Click along gutters, ridges, gables, or windows; press `Enter` or click **Finish** (`ICICLE_DROP_LED` generates 6" hanging sub-drops automatically).
   - **Helix Wrap:** Click the base and top of any porch column or tree trunk; fine-tune turns & radius sliders live.
   - **Foliage Brush:** Drag across shrubs/bushes for minimum-distance Poisson net lighting.
   - **Pathway Stakes:** Click along walkways for ground-snapped vertical stakes + glowing C9 bulbs.
   - **Undo / Redo & Save:** `Ctrl+Z` / `Ctrl+Y`, plus **Save JSON** / **Load JSON**.
4. **Live Telemetry HUD:** Monitor real-time footage, bulb count, watts/amps at 120V, NEC 15A/80% (`1,440W`) GFCI circuit count, and recommended extension ladder height.
5. **Gemini Co-Pilot & BOM:** Click **Critique Night Render** to score the WebGL night-bloom snapshot and preview 3 1-click **Concept Presets**, then click **Generate Hardware BOM** and export to **CSV** or **Markdown**.

---

## Verification & Test Commands

```bash
# Python reconstruction worker tests (FastAPI, .glb normals, cameras, video keyframes)
npm run test:python

# TypeScript Vitest unit tests (schemas, calibration, spline generators, bomMath, copilot)
npm test

# Workspace TypeScript typecheck
npm run typecheck

# Production Next.js & shared-schemas build
npm run build

# End-to-End Playwright verification (launches worker + web app automatically)
npm run test:e2e
```
