# Spec: 2026 Neural Multi-View Live Camera Scanner, Phone QR Sync & SparkJS 3DGS

**Date:** 2026-11-22
**Branch:** `feat/neural-live-scanner-sparkjs`
**Target:** Pull Request into `main` (Invariant #7 PR-Only Workflow)

## 1. Goal & Problem Statement
Single-photo uploads cannot observe true 3D building depth, side walls, attached side wings, or eave overhang geometry, while aerial Google Photorealistic 3D Tiles lack street-level millimeter detail under soffits, alcoves, and railings.

This feature adds **Real-Time Guided Walkaround Camera Scanning + Phone QR Companion Sync**, backed by the verified 2025–2026 open-source 3D vision and rendering stack:
1. **Multi-View Pose & Depth (`depth-anything/DA3-SMALL`, Apache-2.0, `137.2 MB`)** + **Metric Pointmaps & Surface Normals (`Ruicheng/moge-2-vits-normal`, MIT, `140.6 MB`)** on Apple Silicon `mps` / `cuda` / `cpu` (with non-blocking background pre-warming and instant perspective-PBR multi-wall stereo fallback so scans never stall or time out).
2. **World Labs `@sparkjsdev/spark@2.4.0` + `three@0.187.0`** Rust/WASM WebGL2 3D Gaussian Splatting (`SparkRenderer` + `SplatMesh`) composited in depth-buffer sync with Lumen3D's metric raycast `.glb` collider and Night-Bloom `InstancedBulbsLayer`.
3. **Desktop <-> Mobile QR Live Sync (`/scan/[sessionId]`)** supporting both hands-free `getUserMedia` + `DeviceOrientationEvent` compass auto-shutter (`npm run dev:https` / `localhost`) and zero-setup plain-HTTP LAN native camera capture (`capture="environment"` on iOS Safari over `http://<LAN-IP>:3000`).

---

## 2. Shared Data Contracts (`@lumen3d/shared-schemas` & `apps/recon-worker/app/schemas.py`)

- `ScanAngleSectorSchema`: `'front' | 'front_left' | 'left_side' | 'front_right' | 'right_side' | 'rear'`
- `NeuralBackendKindSchema`: `'da3_moge2_mps' | 'moge2_mps' | 'da3_mps' | 'hybrid_multiview_relief'`
- `LiveScanFrameMetaSchema`:
  - `frameId: string`
  - `sector: ScanAngleSector`
  - `sharpnessScore: number`
  - `yawDegrees?: number`
  - `capturedAtIso: string`
- `LiveScanSessionSchema`:
  - `sessionId: string`
  - `status: 'waiting_for_frames' | 'reconstructing' | 'ready' | 'failed'`
  - `address?: string`
  - `targetHeightMeters?: number`
  - `coveredSectors: ScanAngleSector[]`
  - `frames: LiveScanFrameMeta[]`
  - `latestJob?: ReconstructionJob`
  - `neuralBackendUsed: NeuralBackendKind`
  - `guidanceMessage: string`
  - `updatedAtIso: string`
  - `error?: string`

---

## 3. Worker Architecture (`apps/recon-worker`)

### 3.1 `app/neural_metric_engine.py`
- Discovers compute device (`mps` on Apple Silicon, `cuda`, or `cpu`).
- Provides thread-safe, non-blocking lazy/background warmup (`start_background_warmup()`, `get_neural_runtime_status()`):
  - **Tier 1 (`MoGe-2` `Ruicheng/moge-2-vits-normal` + `DA3-SMALL` `depth-anything/DA3-SMALL`):** When `torch` + `moge` (`moge.model.v2.MoGeModel`) and/or `depth_anything_3` (`DepthAnything3`) are installed and cached locally (or `LUMEN3D_ALLOW_HF_DOWNLOAD=1` during explicit warmup / `scripts/install-neural-models.sh`), predicts metric 3D pointmaps $(X,Y,Z)$, foreground sky masks, per-pixel surface normals, and multi-view camera extrinsics/intrinsics $[R \mid t], K$.
  - **Tier 2 (Deterministic Multi-View Stereo & Per-Wall PBR Fusion):** Always-available `< 250ms` multi-view engine that fuses sector-tagged walkaround frames (`front`, `front_left`/`left_side`, `front_right`/`right_side`, `rear`), estimates cross-view homography/parallax depth ratio (`eff_d / eff_w`) between `front` and oblique corner views, projects real captured side-wall photos onto the `-X` Left and `+X` Right 3D `.glb` walls, locks metric height to `targetHeightMeters` when supplied from Google Solar/Elevation, and accumulates dense multi-view 3D Gaussians into `scene.splat`.

### 3.2 `app/live_scan_manager.py` & FastAPI Endpoints (`app/main.py`)
- `GET /health`: extended with `computeDevice`, `da3Available`, `moge2Available`, `weightsWarmState`.
- `POST /models/warmup`: starts asynchronous background weight download/warmup on `mps`/`cuda` without blocking request workers.
- `POST /scan/sessions`: initializes `scan-<10hex>` directory in `RECON_JOBS_DIR`, persists `session.json`.
- `GET /scan/sessions/{session_id}`: returns `LiveScanSession` (in-memory + disk-persisted across `--reload`).
- `POST /scan/sessions/{session_id}/frames`:
  - Validates uploaded JPEG/PNG/WEBP frame, downscales to `<= 960px`, scores focus via `compute_laplacian_sharpness`.
  - Rejects heavily motion-blurred frames (`< 24.0` unless `--force`) with actionable `guidanceMessage`.
  - Infers `sector` when `sector == 'auto'` using compass `yaw_deg` delta from the first frame (or optical-flow horizontal shift against `front` when gyro is absent).
  - Keeps the sharpest frame per sector, fuses all captured sectors into a new versioned artifact set (`scene_<rev>.glb`, `scene_<rev>.splat`, `cameras.json`, `reference_front.png`) so Three.js / SparkJS re-fetches updated URLs cleanly without stale browser URL caching, and returns the updated `LiveScanSession`.

---

## 4. Web & Mobile Architecture (`apps/web`)

### 4.1 Three.js `0.187.0` + `@sparkjsdev/spark@2.4.0` (`SparkSplatLayer.tsx`)
- Upgrade `three` to `^0.187.0` (`@types/three@^0.187.0`) and add `@sparkjsdev/spark@^2.4.0` + `qrcode@^1.5.4` (`@types/qrcode@^1.5.6`).
- Create `apps/web/src/components/canvas/SparkSplatLayer.tsx`:
  - Integrates `SparkRenderer` + `SplatMesh` (`url: splatUrl`) inside `@react-three/fiber` `<Canvas>` alongside `HouseMesh` (raycastable metric `.glb`) and `InstancedBulbsLayer` (Night-Bloom holiday lights).
  - Note: `@sparkjsdev/spark` `SplatMesh` uses standard Three.js/OpenCV splat coordinates natively; verify Y/Z orientation in unit + E2E tests so splats align 1:1 with `HouseMesh`.

### 4.2 Server API Routes (`apps/web/src/app/api/scan/**`)
- `POST /api/scan/sessions/route.ts`:
  - Optionally resolves `address` via `fetchGoogleMapsBuildingContext` (`X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1`, `Cache-Control: no-store`, server-side `GOOGLE_MAPS_API_KEY` only) to extract scalar `targetHeightMeters` (`estimatedHeightMeters`) without violating Google Maps ToS.
  - Creates worker scan session, resolves host LAN IPv4 via `os.networkInterfaces()`, builds `mobileScanUrl` (`<proto>://<lanIp>:<port>/scan/<sessionId>`), generates `qrDataUrl` via `qrcode.toDataURL`, and returns `{ session, mobileScanUrl, qrDataUrl }`.
- `GET /api/scan/sessions/[sessionId]/route.ts` & `POST /api/scan/sessions/[sessionId]/frames/route.ts`:
  - Next.js 16 async `context.params` (`Promise<{ sessionId: string }>`), `export const dynamic = 'force-dynamic'`, `Cache-Control: no-store`, rewriting `latestJob` artifact URLs through `/api/reconstruct`.

### 4.3 Mobile Scanner Page (`/scan/[sessionId]`) & Desktop Live Sync HUD (`LiveScanOverlay.tsx`)
- **Mobile / Standalone Route (`apps/web/src/app/scan/[sessionId]/page.tsx`):**
  - Full-bleed mobile camera scanner UI with 5-sector progress arc (`Front`, `45° Left`, `Left Side`, `45° Right`, `Right Side`).
  - **Secure Context (`HTTPS` / `localhost`):** Live `<video>` viewfinder (`facingMode: 'environment'`), real-time canvas sharpness gauge, iOS `DeviceOrientationEvent.requestPermission()` compass yaw tracker, and hands-free auto-shutter (`400ms` steady lock on uncovered sector) + manual shutter button.
  - **Plain-HTTP LAN Fallback (`!window.isSecureContext`):** Automatic 1-tap sector camera buttons using `<input type="file" accept="image/*" capture="environment">` so iPhone Safari over `http://<LAN-IP>:3000` works immediately with zero certificate friction.
- **Desktop Studio Integration (`StudioLauncher.tsx`, `LiveScanOverlay.tsx`, `page.tsx`):**
  - **"Live Camera Scan (Phone QR / Webcam)"** action in `StudioLauncher` starts a session and opens a compact floating `LiveScanOverlay` card (scannable QR code + copyable LAN URL + inline "Use This Device's Camera" toggle + 5-sector live status pills + "Finish & Design Lights" button).
  - Polls `/api/scan/sessions/[sessionId]` every `700ms`; each time `latestJob.glbUrl` advances (`scene_<rev>.glb`), updates `useStudioStore` (`setJob`) so the user watches their 3D house gain real multi-angle walls, depth, and `.splat` detail live on screen!
- **HTTPS Dev Script (`package.json`):**
  - Add `"dev:https"` script (`next dev --experimental-https -H 0.0.0.0 -p 3000` alongside `dev:worker`) and `scripts/install-neural-models.sh` helper to install optional `torch` + `MoGe-2` + `DA3-SMALL` weights into `apps/recon-worker/.venv`.

---

## 5. Verification Criteria
1. **Python `pytest`:** Live scan session creation, blur rejection, yaw-based auto-sector classification, multi-wall (`front` + `left_side` + `right_side`) progressive `.glb` + `.splat` revision fusion, reload persistence, and neural runtime fallback/mocked `MoGe-2`/`DA3` integration.
2. **TypeScript `vitest` & `typecheck` & `next build`:** Shared scan schemas, LAN URL + QR generation, Next.js 16 async route params, `three@0.187.0` + `@sparkjsdev/spark@2.4.0` build compatibility.
3. **Playwright E2E:** Start Live Camera Scan from `StudioLauncher` -> verify QR code modal -> simulate streaming `front` + `right_side` keyframes into the active scan session -> verify desktop 3D Studio automatically transitions to `MESH_RECON` and updates live as new angles arrive!
