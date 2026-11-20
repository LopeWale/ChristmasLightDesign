'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import type * as THREE from 'three';
import { Sparkles, UploadCloud, Loader2 } from 'lucide-react';
import {
  CamerasPayloadSchema,
  CalibrationDetectionResultSchema,
  ReconstructionJobSchema,
} from '@lumen3d/shared-schemas';
import { Toolbar } from '@/components/panels/Toolbar';
import { TelemetryHUD } from '@/components/panels/TelemetryHUD';
import { CalibrationOverlay } from '@/components/canvas/CalibrationOverlay';
import { computeDesignTelemetry } from '@/lib/geometry/bomMath';
import { calibrateScaleFromDetection } from '@/lib/geometry/raycastCalibration';
import { useStudioStore } from '@/store/useStudioStore';

const StudioViewport = dynamic(
  () =>
    import('@/components/canvas/StudioViewport').then((mod) => mod.StudioViewport),
  { ssr: false }
);

export default function HomePage() {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const sceneGroupRef = useRef<THREE.Group | null>(null);
  const screenshotFnRef = useRef<(() => string) | null>(null);

  const job = useStudioStore((s) => s.job);
  const cameras = useStudioStore((s) => s.cameras);
  const isReconstructing = useStudioStore((s) => s.isReconstructing);
  const reconError = useStudioStore((s) => s.reconError);
  const feetPerSceneUnit = useStudioStore((s) => s.feetPerSceneUnit);
  const calibrationSource = useStudioStore((s) => s.calibrationSource);
  const toolMode = useStudioStore((s) => s.toolMode);
  const rulerPoints = useStudioStore((s) => s.rulerPoints);
  const isCalibrating = useStudioStore((s) => s.isCalibrating);
  const calibrationError = useStudioStore((s) => s.calibrationError);
  const runs = useStudioStore((s) => s.runs);
  const groundMinY = useStudioStore((s) => s.groundMinY);

  const telemetry = useMemo(
    () =>
      computeDesignTelemetry({
        runs,
        feetPerSceneUnit,
        calibrationSource,
        groundMinY,
      }),
    [runs, feetPerSceneUnit, calibrationSource, groundMinY]
  );

  const setJob = useStudioStore((s) => s.setJob);
  const setCameras = useStudioStore((s) => s.setCameras);
  const setDetectedZones = useStudioStore((s) => s.setDetectedZones);
  const setReconstructing = useStudioStore((s) => s.setReconstructing);
  const setCalibrating = useStudioStore((s) => s.setCalibrating);
  const setCalibration = useStudioStore((s) => s.setCalibration);
  const setToolMode = useStudioStore((s) => s.setToolMode);
  const clearRulerPoints = useStudioStore((s) => s.clearRulerPoints);

  // Expose store handle in browser window for deterministic diagnostics & E2E inspection
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as { __LUMEN3D_STORE__?: typeof useStudioStore }).__LUMEN3D_STORE__ =
        useStudioStore;
    }
  }, []);

  const pollJobUntilComplete = useCallback(
    async (jobId: string) => {
      for (let attempt = 0; attempt < 180; attempt++) {
        const resp = await fetch(
          `/api/reconstruct?jobId=${encodeURIComponent(jobId)}`,
          { cache: 'no-store' }
        );
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data.error || 'Failed to poll reconstruction job');
        }
        const parsed = ReconstructionJobSchema.parse(data);
        setJob(parsed);

        if (parsed.status === 'completed') {
          if (parsed.camerasUrl) {
            const camResp = await fetch(parsed.camerasUrl, { cache: 'no-store' });
            if (camResp.ok) {
              const camJson = await camResp.json();
              const camPayload = CamerasPayloadSchema.parse(camJson);
              setCameras(camPayload.cameras);
            }
          }
          setReconstructing(false, null);
          return;
        }

        if (parsed.status === 'failed') {
          throw new Error(parsed.error || '3D reconstruction failed');
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('Timed out waiting for reconstruction job');
    },
    [setCameras, setJob, setReconstructing]
  );

  const handleLoadSampleHouse = async () => {
    try {
      setReconstructing(true, null);
      const resp = await fetch('/api/reconstruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demo: true }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to launch sample house build');
      }
      const initialJob = ReconstructionJobSchema.parse(data);
      setJob(initialJob);
      await pollJobUntilComplete(initialJob.jobId);
    } catch (err) {
      setReconstructing(
        false,
        err instanceof Error ? err.message : 'Sample house build failed'
      );
    }
  };

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    try {
      setReconstructing(true, null);
      const formData = new FormData();
      Array.from(fileList).forEach((f) => formData.append('files', f));
      formData.append('mode', 'auto');

      const resp = await fetch('/api/reconstruct', {
        method: 'POST',
        body: formData,
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Upload reconstruction failed');
      }
      const initialJob = ReconstructionJobSchema.parse(data);
      setJob(initialJob);
      await pollJobUntilComplete(initialJob.jobId);
    } catch (err) {
      setReconstructing(
        false,
        err instanceof Error ? err.message : 'Upload reconstruction failed'
      );
    } finally {
      e.target.value = '';
    }
  };

  const handleAutoCalibrate = async () => {
    if (!job || !sceneGroupRef.current || cameras.length === 0) {
      setCalibrating(false, 'Load a 3D house mesh with camera metadata first.');
      return;
    }

    try {
      setCalibrating(true, null);
      const resp = await fetch('/api/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.jobId,
          referenceImageUrl: job.referenceImageUrl,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Gemini spatial calibration failed');
      }
      const detection = CalibrationDetectionResultSchema.parse(data);
      setDetectedZones(detection.zones);

      const outcome = calibrateScaleFromDetection({
        detection,
        camera: cameras[0],
        targetObject: sceneGroupRef.current,
      });
      setCalibration(outcome.feetPerSceneUnit, outcome.calibrationSource);
      setCalibrating(false, null);
    } catch (err) {
      setCalibrating(
        false,
        err instanceof Error ? err.message : 'Auto-calibration failed'
      );
    }
  };

  void screenshotFnRef;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-studio-bg text-slate-100">
      {/* Top Studio Header Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-studio-border bg-slate-950/90 px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400 ring-1 ring-amber-400/40">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-100">
              Lumen3D Studio
            </h1>
            <p className="text-[11px] text-slate-400">
              Metric 3D Exterior Reconstruction &amp; Night-Bloom Holiday Lighting
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="btn-load-sample-house"
            disabled={isReconstructing}
            onClick={handleLoadSampleHouse}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow transition hover:bg-amber-400 disabled:opacity-50"
          >
            {isReconstructing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Load Sample House
          </button>

          <button
            type="button"
            data-testid="btn-upload-media"
            disabled={isReconstructing}
            onClick={() => uploadInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <UploadCloud className="h-3.5 w-3.5" />
            Upload Photos / Video
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
            onChange={handleUploadFiles}
            className="hidden"
          />
        </div>
      </header>

      {/* Main Studio Body */}
      <div className="flex min-h-0 flex-1">
        <Toolbar />

        <main className="relative min-w-0 flex-1">
          <StudioViewport
            onSceneReady={(group) => {
              sceneGroupRef.current = group;
            }}
            onRegisterScreenshot={(fn) => {
              screenshotFnRef.current = fn;
            }}
          />

          {/* Top-left floating Spatial Calibration Overlay */}
          <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-xl">
            <CalibrationOverlay
              feetPerSceneUnit={feetPerSceneUnit}
              calibrationSource={calibrationSource}
              toolMode={toolMode}
              rulerPoints={rulerPoints}
              isCalibrating={isCalibrating}
              calibrationError={calibrationError}
              hasScene={Boolean(job?.status === 'completed' && job?.glbUrl)}
              onAutoCalibrate={handleAutoCalibrate}
              onSetToolMode={setToolMode}
              onClearRulerPoints={clearRulerPoints}
              onApplyManualScale={(scale) => setCalibration(scale, 'MANUAL_RULER')}
            />
          </div>

          {/* Bottom-right Live Electrical & Footage Telemetry HUD */}
          <div className="pointer-events-none absolute bottom-4 right-4 z-10 w-[420px] max-w-[calc(100%-2rem)]">
            <TelemetryHUD telemetry={telemetry} />
          </div>

          {/* Empty state welcome card before loading a 3D facade */}
          {!job && !isReconstructing && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-md rounded-2xl border border-slate-800 bg-slate-950/90 p-6 text-center shadow-2xl backdrop-blur-md">
                <h2 className="text-base font-bold text-slate-100">
                  Reconstruct Your 3D Exterior Facade
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  Upload multi-view exterior photos or a walkaround MP4/MOV video, or launch
                  the metric-calibrated architectural Sample House to start designing in 3D
                  Night-Bloom mode.
                </p>
                {reconError && (
                  <p className="mt-3 rounded-lg bg-rose-950/60 p-2 text-xs text-rose-300">
                    {reconError}
                  </p>
                )}
                <div className="mt-4 flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={handleLoadSampleHouse}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Load Sample House
                  </button>
                </div>
              </div>
            </div>
          )}

          {isReconstructing && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-5 text-center shadow-2xl">
                <Loader2 className="mx-auto h-7 w-7 animate-spin text-amber-400" />
                <p className="mt-3 text-sm font-semibold text-slate-100">
                  Reconstructing 3D Exterior Mesh…
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Progress: {job?.progress ?? 10}% ({job?.mode ?? 'auto'})
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
