# Lumen3D — 3D Exterior Reconstruction & Holiday Lighting Studio

**Lumen3D** is a full-stack monorepo studio that reconstructs multi-view building photos or walkaround videos—optionally enriched with **Google Maps Platform** building outlines, roof heights, and Street View orientation—into a rotatable 360° metric-calibrated 3D collider mesh. It supports both **multi-story condos with cantilevered/recessed balconies & guardrails** and **single-family pitched-roof homes**, renders holiday light installations (`C9`, `C7`, `5mm Mini`, `Icicle Drops`, `RGB Soffit Pucks`, `Pathway Stakes`) with night-bloom post-processing, computes deterministic wire footage, NEC electrical loads & walk-out balcony/ground ladder sizing, and pairs with Google Gemini (`@google/genai`) for spatial auto-calibration, visual night-render critique, interactive concept presets, and HOA-friendly Bills of Materials (BOM).

---

## Architecture Overview

```text
lumen3d/
├── AGENTS.md                        # Persistent architecture invariants, ports, & gate status
├── README.md                        # Setup & one-command run instructions (GPU, Condo/Maps & Synthetic)
├── .env.example                     # Server-side environment template
├── packages/
│   └── shared-schemas/              # Strict TypeScript + Zod contracts (@lumen3d/shared-schemas)
└── apps/
    ├── recon-worker/                # FastAPI 3D reconstruction worker (port 8001)
    │   └── app/                     # Architectural Condo/Home Builder, OpenCV Facade Analyzer, VGGT & Synthetic
    └── web/                         # Next.js 14 App Router + React Three Fiber Studio (port 3000)
```

---

## Prerequisites

- **Node.js** `20+` and **npm** `10+`
- **Python** `3.11+` (e.g., Python `3.12`)
- **Google Gemini API Key** (`GEMINI_API_KEY`)
- *(Optional)* **Google Maps Platform API Key** (`GOOGLE_MAPS_API_KEY`) for address-based building outline & height enrichment

---

## Setup

### 1. Configure `.env`
Copy `.env.example` to `.env` in the cloned repository root (automatically loaded server-side):

```bash
cp .env.example .env
```

Edit `.env` and set your keys:

```dotenv
GEMINI_API_KEY=your_real_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
GOOGLE_MAPS_API_KEY=your_optional_google_maps_api_key
RECON_BACKEND=auto
RECON_WORKER_URL=http://127.0.0.1:8001
```

#### Google Maps Platform API Key Setup (Optional)
- **Zero-Cost Prototyping (Maps Demo Key):** You can mint a free prototyping key (no billing card or Cloud project setup required; daily reset quota, not for production) by signing in at [Google Maps Demo Key](https://mapsplatform.google.com/maps-demo-key?utm_campaign=gmp_git_agentskills_v1), accepting the Maps Demo Project Terms, and pasting the key as `GOOGLE_MAPS_API_KEY` in `.env`.
- **Production Key:** Create an API key in the [Google Cloud Console Credentials Page](https://console.cloud.google.com/google/maps-apis/credentials?utm_campaign=gmp_git_agentskills_v1), enable **Geocoding API**, **Street View Static API**, **Solar API**, and **Maps Elevation API**, and restrict your key (IP/referrer & API restrictions) per [Google Cloud API Key Restrictions](https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys?utm_campaign=gmp_git_agentskills_v1). Usage of Google Maps Platform services in production may incur costs against your Google Cloud billing account and is governed by the [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms?utm_campaign=gmp_git_agentskills_v1) and [Google Maps End User Additional Terms](https://maps.google.com/help/terms_maps/?utm_campaign=gmp_git_agentskills_v1).

### 2. Install Node & Python Dependencies

```bash
# Install npm workspace packages
npm install

# Create Python 3.11+ virtual environment & install recon-worker
python3.12 -m venv apps/recon-worker/.venv
apps/recon-worker/.venv/bin/pip install -e "apps/recon-worker[dev]"
```

*(Optional — GPU VGGT Mode)* On an NVIDIA CUDA workstation:
```bash
apps/recon-worker/.venv/bin/pip install torch torchvision open3d git+https://github.com/facebookresearch/vggt.git
```

---

## One-Command Startup

```bash
npm run dev
```
- **Web Studio:** http://localhost:3000
- **3D Recon Worker:** http://127.0.0.1:8001/health

---

## Studio Workflow (Condos, Balconies & Single-Family Homes)

1. **Load Preset or Upload Media + Address:**
   - Click **Sample 3F Condo** to load a 3-story condo with 2 balconies (`2F` metal picket + `3F` glass guardrail), **Sample House** for a 1-story gable residence, or enter an optional **Street Address** and click **Upload Photos / Video** (`.jpg`, `.png`, `.webp`, `.mp4`, `.mov`).
   - Use the **3D Building & Balconies** panel in the left sidebar to fine-tune floor count (`1–6`), roof style (`Flat Parapet`, `Pitched Gable`, `Hip`), and individual balconies (`floor`, `front/left/right/rear` wall, `cantilevered/recessed`, `picket/glass/parapet` guardrail) and rebuild in `< 1s`.
2. **Spatial Scale Calibration:** Click **Auto-Calibrate (Gemini)** or **2-Click Ruler**.
3. **360° Light Design:** Orbit around all 4 facades and snap C9s, icicles, soffit pucks, column helices, bush scatter, or walkway stakes onto any surface—including `balcony_railing` and `balcony_soffit`.
4. **Condo-Smart Telemetry & HOA BOM:** Walk-out `balcony_railing` runs require `0 ft` exterior ladders and automatically select non-drilling railing clamps & UV zip-ties in the BOM.

---

## Verification & Test Commands

```bash
npm run test:python
npm test
npm run typecheck
npm run build
npm run test:e2e
```
