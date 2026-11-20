# Lumen3D — 3D Exterior Reconstruction & Holiday Lighting Studio

Production-grade monorepo web studio for reconstructing multi-view building exteriors into metric-calibrated 3D collider meshes, designing holiday light installations with realistic night-bloom rendering, and generating deterministic electrical telemetry & Gemini-assisted Bill of Materials (BOM).

## Quick Start

1. Copy `.env.example` to `.env` in the repository root and set `GEMINI_API_KEY`:
   ```bash
   cp .env.example .env
   ```
2. Install dependencies and start both the Python reconstruction worker (`:8001`) and Next.js studio (`:3000`):
   ```bash
   npm install
   npm run dev
   ```
