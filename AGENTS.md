# AGENTS.md — Lumen3D Persistent Repository Guide

## Overview
**Lumen3D** is a monorepo web studio for 3D exterior multi-view reconstruction, metric spatial scale calibration, multi-orientation holiday light design with night-bloom rendering, deterministic NEC electrical/footage math, and Gemini-powered design critique & Bill of Materials (BOM) generation.

## Hard Architectural Invariants (Non-Negotiable)
1. **Multi-View Scene Reconstruction Only:** Never use single-object 3D mesh generators (`TripoSR`, `TRELLIS`, `Zero123`, `Shap-E`). Always use `apps/recon-worker` (`facebookresearch/vggt` + `Open3D` `ScalableTSDFVolume` or the deterministic `synthetic` multi-part architectural house backend).
2. **Dual-Mode Reconstruction (`RECON_BACKEND=auto|vggt|synthetic`):** `auto` selects `vggt` when CUDA + VGGT/Open3D are available, and falls back deterministically to `synthetic` on CPU/CI runners.
3. **Decimated `.glb` Mesh with Vertex Normals:** Every reconstruction job emits `scene.glb` (`<= 300k` faces, valid vertex normals, zero `NaN` vertices), `cameras.json`, and `reference_front.png`.
4. **Deterministic Math First, LLM Second:** Spline arc-lengths (feet), bulb counts, wattage, NEC 15A/80% (`1,440W`) circuit loads, `210W` / `200 ft` series run limits, and 4:1 + 3ft ladder sizing are computed purely in TypeScript (`bomMath.ts`) before passing `DesignTelemetry` JSON to Gemini.
5. **Pinned Gemini SDK & Key Hygiene:**
   - Use ONLY `@google/genai` (`import { GoogleGenAI, Type } from '@google/genai'`). Never install or import `@google/generative-ai`.
   - Keep `GEMINI_API_KEY` strictly server-side inside `apps/web/src/app/api/**`. Never expose keys via `NEXT_PUBLIC_*`.
   - Default model: `gemini-2.5-flash` (override via `GEMINI_MODEL`).
   - Root `.env` and `apps/web/.env` are both supported server-side.
   - Deterministic mock responses are returned **only** when `GEMINI_MOCK_MODE=true`.
6. **WebGL Buffer Preservation:** `<Canvas gl={{ preserveDrawingBuffer: true, antialias: true }}>` is mandatory so `toDataURL('image/png')` captures real rendered night-bloom frames for multimodal critique.

## Ports & Services
| Service | Path | Port | URL |
| :--- | :--- | :--- | :--- |
| Web Studio (Next.js App Router) | `apps/web` | `3000` | `http://localhost:3000` |
| 3D Recon Worker (Python FastAPI) | `apps/recon-worker` | `8001` | `http://127.0.0.1:8001` |
| Shared Contracts (TypeScript + Zod) | `packages/shared-schemas` | — | Workspace library `@lumen3d/shared-schemas` |

## Environment Variables
- `GEMINI_API_KEY`: Google Gemini API key (server-side only; loaded from shell, `.env`, or `apps/web/.env`).
- `GEMINI_MODEL`: Gemini model identifier (defaults to `gemini-2.5-flash`).
- `GEMINI_MOCK_MODE`: Set to `true` only in offline automated tests (`vitest` / `playwright`).
- `RECON_BACKEND`: `auto` (default) | `vggt` | `synthetic`.
- `RECON_WORKER_URL`: Base URL of FastAPI reconstruction worker (defaults to `http://127.0.0.1:8001`).

## Commands
```bash
# Install Node workspace dependencies
npm install

# Build shared schemas & Next.js web app
npm run build

# Run workspace TypeScript typechecks
npm run typecheck

# Run Vitest unit suites (shared-schemas + web geometry/math/calibration)
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
- [ ] **Gate 4:** Deterministic Footage, NEC Electrical & Ladder Safety Engine (`bomMath.ts`)
- [ ] **Gate 5:** Gemini Multimodal Design Co-Pilot, Hardware BOM & E2E Verification
