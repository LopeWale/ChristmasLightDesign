# Implementation Plan: 2026 Neural Live Camera Scanner, Phone QR Sync & SparkJS 3DGS

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` + `test-driven-development` (RED -> GREEN -> REFACTOR) on feature branch `feat/neural-live-scanner-sparkjs` and submit via GitHub PR (Invariant #7).

**Goal:** Deliver real-time guided walkaround camera scanning with Phone QR live desktop sync, powered by `DA3-SMALL` + `MoGe-2` Apple Silicon `mps` neural metric geometry (with instant multi-view PBR fallback) and World Labs `@sparkjsdev/spark@2.4.0` (`three@0.187.0`) 3D Gaussian Splat rendering.

**Tech Stack:** TypeScript, Zod, Next.js 16.4.6 (`--experimental-https`, App Router async params), `three@0.187.0`, `@sparkjsdev/spark@2.4.0`, `qrcode`, FastAPI, OpenCV, Trimesh, optional PyTorch `mps` (`Ruicheng/moge-2-vits-normal` + `depth-anything/DA3-SMALL`).

---

### Task 1: Shared Scan Contracts & `three@0.187` + `@sparkjsdev/spark@2.4` Upgrade
- **Files:**
  - Modify: `packages/shared-schemas/src/index.ts`
  - Modify: `packages/shared-schemas/tests/schemas.test.ts`
  - Modify: `apps/recon-worker/app/schemas.py`
  - Modify: `apps/web/package.json` & `package.json` (`dev:https`)
- **TDD Steps:**
  1. Write failing schema validation tests in `packages/shared-schemas/tests/schemas.test.ts` for `ScanAngleSectorSchema`, `LiveScanSessionSchema`, and `LiveScanFrameMetaSchema`.
  2. Implement matching Zod + Pydantic models (`ScanAngleSector`, `LiveScanFrameMeta`, `LiveScanSession`, versioned artifact filenames `scene_<rev>.glb` / `scene_<rev>.splat`).
  3. Upgrade `three` (`^0.187.0`), `@types/three` (`^0.187.0`), add `@sparkjsdev/spark@^2.4.0`, `qrcode@^1.5.4`, `@types/qrcode@^1.5.6`, and verify `npm test` + `npm run typecheck`.

### Task 2: 2026 Neural Metric Engine (`MoGe-2` + `DA3-SMALL`) & Multi-Wall Live Scan Fusion
- **Files:**
  - Create: `apps/recon-worker/app/neural_metric_engine.py`
  - Create: `apps/recon-worker/app/live_scan_manager.py`
  - Modify: `apps/recon-worker/app/photo_mesh_builder.py` (accept per-wall `left_bgr`, `right_bgr`, `rear_bgr`, `target_height_m`, and neural normal/depth maps)
  - Modify: `apps/recon-worker/app/main.py` (`/health` neural readiness, `POST /models/warmup`, `/scan/sessions`, `/scan/sessions/{id}/frames`, artifact filename regex supporting `scene_r001.glb` / `.splat`)
  - Create: `scripts/install-neural-models.sh`
  - Create: `apps/recon-worker/tests/test_live_scan_and_neural.py`
- **TDD Steps:**
  1. Write failing `pytest` tests in `test_live_scan_and_neural.py`:
     - Session creation & reload persistence
     - Blurry frame rejection (`sharpness < 24.0`) with guidance message
     - Auto-sector classification from compass yaw (`0° -> front`, `-40° -> front_left`, `+85° -> right_side`)
     - Multi-wall UV fusion (`front` + `left_side` + `right_side` producing distinct left/right wall textures + versioned `scene_r001.glb` / `scene_r002.glb` + `.splat`)
     - Neural runtime adapter test (`MoGe-2` metric pointmap + sky mask + normal integration & non-blocking background warmup)
  2. Implement `neural_metric_engine.py`, `live_scan_manager.py`, multi-wall `photo_mesh_builder.py`, and FastAPI routes until all Python tests pass GREEN.

### Task 3: Next.js 16 Live Scan API Proxy, LAN QR Generator & Artifact Rewriting
- **Files:**
  - Create: `apps/web/src/lib/scan/scanProxy.ts`
  - Create: `apps/web/src/app/api/scan/sessions/route.ts`
  - Create: `apps/web/src/app/api/scan/sessions/[sessionId]/route.ts`
  - Create: `apps/web/src/app/api/scan/sessions/[sessionId]/frames/route.ts`
  - Modify: `apps/web/src/app/api/reconstruct/route.ts` (preserve exact artifact filename in `rewriteJobUrls` so `scene_r002.glb` & `scene_r002.splat` bust browser cache cleanly!)
  - Create: `apps/web/tests/liveScanApi.test.ts`
- **TDD Steps:**
  1. Write failing Vitest tests in `liveScanApi.test.ts` verifying LAN IPv4 URL resolution, SVG/PNG QR data URL generation, Maps `estimatedHeightMeters` -> `targetHeightMeters` forwarding, and versioned `scene_r002.glb` URL rewriting.
  2. Implement `scanProxy.ts` and the 3 Next.js 16 dynamic routes (`await context.params`, `dynamic = 'force-dynamic'`, `Cache-Control: no-store`) and verify GREEN.

### Task 4: SparkJS 2.4 (`SplatMesh`) Viewport Integration, `/scan/[sessionId]` Mobile Scanner & Desktop Live Sync HUD
- **Files:**
  - Create: `apps/web/src/components/canvas/SparkSplatLayer.tsx`
  - Modify: `apps/web/src/components/canvas/StudioViewport.tsx` (swap `<Splat>` to `<SparkSplatLayer>` with `<SplatErrorBoundary>`)
  - Create: `apps/web/src/components/panels/LiveScanOverlay.tsx`
  - Create: `apps/web/src/app/scan/[sessionId]/page.tsx`
  - Modify: `apps/web/src/components/panels/StudioLauncher.tsx` & `apps/web/src/app/page.tsx`
  - Modify: `apps/web/tests/studio.spec.ts` (add E2E 5 testing full QR Live Scan session -> streaming multi-angle frames -> live 3D studio update)
- **TDD Steps:**
  1. Implement `SparkSplatLayer.tsx`, mobile `/scan/[sessionId]/page.tsx` (both `getUserMedia` auto-shutter + `http://` native `capture="environment"` fallback), and desktop `LiveScanOverlay.tsx`.
  2. Run full verification (`pytest`, `vitest`, `typecheck`, `next build`, Playwright E2E 1–5), capture visual screenshots of the new Live Scanner + QR modal, push `feat/neural-live-scanner-sparkjs`, and open **PR #2** via `gh pr create`.
