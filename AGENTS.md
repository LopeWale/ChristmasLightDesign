# AGENTS.md — Lumen3D Persistent Repository Guide

## Overview
**Lumen3D** is a monorepo web studio for 3D exterior multi-view & address-guided reconstruction (supporting multi-story condos with balconies as well as pitched-roof homes), metric spatial scale calibration, multi-orientation holiday light design with night-bloom rendering, deterministic NEC electrical & walk-out balcony ladder math, and Gemini-powered design critique & HOA-safe Bill of Materials (BOM) generation.

## Hard Architectural Invariants (Non-Negotiable)
1. **Multi-View & Address-Guided Scene Reconstruction Only:** Never use single-object 3D mesh generators (`TripoSR`, `TRELLIS`, `Zero123`, `Shap-E`). Always use `apps/recon-worker` (`ArchitecturalReconstructor` powered by Google Maps `displayPolygon`/Solar + Gemini/OpenCV `cv_facade_analyzer.py`, `VGGTReconstructor` + `Open3D` `ScalableTSDFVolume` on CUDA, or the classic `SyntheticReconstructor` house).
2. **Multi-Mode Reconstruction (`RECON_BACKEND=auto|architectural|vggt|synthetic`):** `auto` selects `vggt` when CUDA + VGGT/Open3D are installed (without an explicit `ArchitecturalBuildingSpec`), and otherwise uses `architectural` (`cv_facade_analyzer.py` + `architectural_backend.py`) so uploaded condo/home photos and videos produce matching multi-story 360° `.glb` buildings on CPU / Apple Silicon.
3. **Decimated `.glb` Mesh with Outward Vertex Normals:** Every reconstruction job emits `scene.glb` (`<= 250k` faces, valid unit-length outward vertex normals, zero `NaN` vertices, `minY = 0.0`), `cameras.json`, and `reference_front.png`.
4. **Deterministic Math First, LLM Second:** Spline arc-lengths (feet), bulb counts, wattage, NEC 15A/80% (`1,440W`) circuit loads, `210W` / `200 ft` series run limits, walk-out balcony ladder sizing (`0 ft` for `balcony_railing`, `6 ft` step-stool for `balcony_soffit`), and `4:1 + 3ft` exterior extension ladder sizing are computed purely in TypeScript (`bomMath.ts`) before passing `DesignTelemetry` JSON to Gemini.
5. **Pinned Gemini SDK, Google Maps Platform ToS & Key Hygiene:**
   - Use ONLY `@google/genai` (`import { GoogleGenAI, Type } from '@google/genai'`). Never install or import `@google/generative-ai`.
   - Keep `GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY` strictly server-side inside `apps/web/src/app/api/**`. Never expose keys via `NEXT_PUBLIC_*`.
   - Include `X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1` and `Cache-Control: no-store` on all Google Maps REST requests; never mix non-Google map data, never train models on Maps content, and always require user media alongside address enrichment.
   - Root `.env` and `apps/web/.env` are both supported server-side.
   - Deterministic mock responses are returned **only** when `GEMINI_MOCK_MODE=true`.
6. **WebGL Buffer Preservation:** `<Canvas gl={{ preserveDrawingBuffer: true, antialias: true }}>` is mandatory so `toDataURL('image/png')` captures real composited night-bloom frames for multimodal critique.

## Ports & Services
| Service | Path | Port | URL |
| :--- | :--- | :--- | :--- |
| Web Studio (Next.js App Router) | `apps/web` | `3000` | `http://localhost:3000` |
| 3D Recon Worker (Python FastAPI) | `apps/recon-worker` | `8001` | `http://127.0.0.1:8001` |
| Shared Contracts (TypeScript + Zod) | `packages/shared-schemas` | — | Workspace library `@lumen3d/shared-schemas` |

## Environment Variables
- `GEMINI_API_KEY`: Google Gemini API key (server-side only; loaded from shell, `.env`, or `apps/web/.env`).
- `GEMINI_MODEL`: Gemini model identifier (defaults to `gemini-2.5-flash`).
- `GOOGLE_MAPS_API_KEY`: Optional Google Maps Platform API key (Geocoding v4, Solar API, Elevation API, Street View Static API; supports the free Maps Demo Key for prototyping).
- `GEMINI_MOCK_MODE`: Set to `true` only in offline automated tests (`vitest` / `playwright`).
- `RECON_BACKEND`: `auto` (default) | `architectural` | `vggt` | `synthetic`.
- `RECON_WORKER_URL`: Base URL of FastAPI reconstruction worker (defaults to `http://127.0.0.1:8001`).

## Commands
```bash
# Install Node workspace dependencies
npm install

# Build shared schemas & Next.js web app
npm run build

# Run workspace TypeScript typechecks
npm run typecheck

# Run Vitest unit suites (shared-schemas + web geometry/math/calibration/maps/copilot)
npm test

# Run Python reconstruction worker pytest suite
apps/recon-worker/.venv/bin/pytest apps/recon-worker/tests

# Run Playwright E2E suite
npm run test:e2e

# Start both services in development mode
npm run dev
```

## Gate Execution Status
- [x] **Gate 0:** Workspace Scaffold, Shared Schemas & `AGENTS.md`
- [x] **Gate 1:** Multi-View 3D Reconstruction Service (`apps/recon-worker`)
- [x] **Gate 2:** Gemini Spatial Calibration & 3D Back-Projection
- [x] **Gate 3:** Interactive 3D Night Studio & Parametric Multi-Orientation Light Tools
- [x] **Gate 4:** Deterministic Footage, NEC Electrical & Ladder Safety Engine (`bomMath.ts`)
- [x] **Gate 5:** Gemini Multimodal Design Co-Pilot, Hardware BOM & E2E Verification
- [x] **Phase 2:** Google Maps Footprint + Multi-Story Condo & Balcony 3D Reconstruction
