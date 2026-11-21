'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import {
  Sparkles,
  Loader2,
  Building2,
  Sun,
  Sunset,
  Moon,
  ShoppingBag,
  Ruler,
  ChevronDown,
  FolderOpen,
} from 'lucide-react';
import {
  CamerasPayloadSchema,
  CalibrationDetectionResultSchema,
  ReconstructionJobSchema,
  type ArchitecturalBuildingSpec,
} from '@lumen3d/shared-schemas';
import { StudioLauncher } from '@/components/panels/StudioLauncher';
import { FloatingDock } from '@/components/panels/FloatingDock';
import { TelemetryHUD } from '@/components/panels/TelemetryHUD';
import { CopilotDrawer } from '@/components/panels/CopilotDrawer';
import { BuildingAdjuster } from '@/components/panels/BuildingAdjuster';
import { CalibrationOverlay } from '@/components/canvas/CalibrationOverlay';
import { computeDesignTelemetry } from '@/lib/geometry/bomMath';
import {
  CLIENT_CONDO_SPEC,
  CLIENT_HOUSE_SPEC,
  buildClientProceduralBuilding,
} from '@/lib/geometry/proceduralBuilding';
import { calibrateScaleFromDetection } from '@/lib/geometry/raycastCalibration';
import {
  loadSamplePresetWithFallback,
  resolveAddressLaunchAction,
} from '@/lib/studioLaunchFlow';
import { useStudioStore, type LightingMode } from '@/store/useStudioStore';

const StudioViewport = dynamic(
  () =>
    import('@/components/canvas/StudioViewport').then((mod) => mod.StudioViewport),
  { ssr: false }
);

export default function HomePage() {
  const sceneGroupRef = useRef<THREE.Group | null>(null);
  const screenshotFnRef = useRef<(() => string) | null>(null);

  const [streetAddress, setStreetAddress] = useState<string>('');
  const [launcherModalOpen, setLauncherModalOpen] = useState<boolean>(false);
  const [launcherGuide, setLauncherGuide] = useState<string | null>(null);
  const [isAdjusterOpen, setIsAdjusterOpen] = useState<boolean>(false);
  const [isScaleOpen, setIsScaleOpen] = useState<boolean>(false);

  const sceneSource = useStudioStore((s) => s.sceneSource);
  const sceneTitle = useStudioStore((s) => s.sceneTitle);
  const proceduralPreset = useStudioStore((s) => s.proceduralPreset);
  const proceduralSpec = useStudioStore((s) => s.proceduralSpec);
  const activeDrawer = useStudioStore((s) => s.activeDrawer);
  const lightingMode = useStudioStore((s) => s.lightingMode);
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
  const mapsAttribution = useStudioStore((s) => s.mapsAttribution);
  const mapsWarnings = useStudioStore((s) => s.mapsWarnings);

  const setJob = useStudioStore((s) => s.setJob);
  const setTilesScene = useStudioStore((s) => s.setTilesScene);
  const setProceduralScene = useStudioStore((s) => s.setProceduralScene);
  const setActiveDrawer = useStudioStore((s) => s.setActiveDrawer);
  const setLightingMode = useStudioStore((s) => s.setLightingMode);
  const setCameras = useStudioStore((s) => s.setCameras);
  const setDetectedZones = useStudioStore((s) => s.setDetectedZones);
  const setReconstructing = useStudioStore((s) => s.setReconstructing);
  const setMapsStatus = useStudioStore((s) => s.setMapsStatus);
  const setCalibrating = useStudioStore((s) => s.setCalibrating);
  const setCalibration = useStudioStore((s) => s.setCalibration);
  const setToolMode = useStudioStore((s) => s.setToolMode);
  const clearRulerPoints = useStudioStore((s) => s.clearRulerPoints);

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

  // Active editable buildingSpec (either from worker job, edited procedural spec, or default preset)
  const activeBuildingSpec: ArchitecturalBuildingSpec | null = useMemo(() => {
    if (job?.buildingSpec) return job.buildingSpec;
    if (proceduralSpec) return proceduralSpec;
    if (proceduralPreset === 'condo') return CLIENT_CONDO_SPEC;
    if (proceduralPreset === 'house') return CLIENT_HOUSE_SPEC;
    return null;
  }, [job?.buildingSpec, proceduralSpec, proceduralPreset]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (
        window as unknown as { __LUMEN3D_STORE__?: typeof useStudioStore }
      ).__LUMEN3D_STORE__ = useStudioStore;
    }
  }, []);

  const pollJobUntilComplete = useCallback(
    async (jobId: string, titleOverride?: string) => {
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
        setJob(parsed, titleOverride);

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
          setLauncherModalOpen(false);
          return;
        }

        if (parsed.status === 'failed') {
          throw new Error(parsed.error || '3D reconstruction failed');
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error('Timed out waiting for reconstruction job');
    },
    [setCameras, setJob, setReconstructing]
  );

  const handleSubmitAddress = async (addr: string) => {
    setLauncherGuide(null);
    setReconstructing(true, null);
    try {
      const action = await resolveAddressLaunchAction(addr);
      if (action.kind === 'LOAD_3D_TILES') {
        setMapsStatus(action.attribution, action.warnings);
        setTilesScene(action.formattedAddress, action.anchor);
        setLauncherModalOpen(false);
        return;
      }
      if (action.kind === 'NEEDS_TILES_API_OR_PHOTOS') {
        setMapsStatus('Map data © Google', action.warnings);
        setLauncherGuide(action.message);
        setReconstructing(false, null);
        return;
      }
      setLauncherGuide(action.message);
      setReconstructing(false, null);
    } catch (err) {
      setReconstructing(
        false,
        err instanceof Error ? err.message : 'Address lookup failed'
      );
    }
  };

  const handleLoadSamplePreset = async (preset: 'condo' | 'house') => {
    setLauncherGuide(null);
    setMapsStatus(null, []);
    setReconstructing(true, null);
    const label =
      preset === 'condo'
        ? '3-Story Condo · 2 Balconies'
        : 'Suburban Gable Residence';

    const outcome = await loadSamplePresetWithFallback(preset);
    if (outcome.kind === 'CLIENT_PROCEDURAL') {
      const built = buildClientProceduralBuilding(preset);
      setCameras(built.cameras);
      setProceduralScene(preset, label);
      setLauncherModalOpen(false);
      return;
    }

    try {
      setJob(outcome.job, label);
      await pollJobUntilComplete(outcome.job.jobId, label);
    } catch {
      // Seamless fallback if worker stopped mid-poll
      const built = buildClientProceduralBuilding(preset);
      setCameras(built.cameras);
      setProceduralScene(preset, label);
      setLauncherModalOpen(false);
    }
  };

  const handleRebuildBuildingSpec = async (spec: ArchitecturalBuildingSpec) => {
    try {
      setReconstructing(true, null);
      const resp = await fetch('/api/reconstruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildingSpec: spec }),
      });
      if (!resp.ok) {
        const built = buildClientProceduralBuilding(spec);
        setCameras(built.cameras);
        setProceduralScene(spec, spec.sourceSummary);
        return;
      }
      const initialJob = ReconstructionJobSchema.parse(await resp.json());
      setJob(initialJob, spec.sourceSummary);
      await pollJobUntilComplete(initialJob.jobId, spec.sourceSummary);
    } catch {
      const built = buildClientProceduralBuilding(spec);
      setCameras(built.cameras);
      setProceduralScene(spec, spec.sourceSummary);
    }
  };

  const handleUploadFiles = async (
    fileList: FileList,
    reconMode: 'auto' | 'da3'
  ) => {
    if (!fileList || fileList.length === 0) return;
    setLauncherGuide(null);

    try {
      setReconstructing(true, null);
      const trimmedAddr = streetAddress.trim();
      const formData = new FormData();
      Array.from(fileList).forEach((f) => formData.append('files', f));
      formData.append('mode', reconMode);
      if (trimmedAddr) {
        formData.append('address', trimmedAddr);
        fetch('/api/maps/building-context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: trimmedAddr }),
        })
          .then(async (r) => {
            const j = await r.json();
            if (r.ok) {
              setMapsStatus(
                j.streetViewCopyright || 'Map data © Google',
                Array.isArray(j.warnings) ? j.warnings : []
              );
            }
          })
          .catch(() => {});
      } else {
        setMapsStatus(null, []);
      }

      const resp = await fetch('/api/reconstruct', {
        method: 'POST',
        body: formData,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(
          data.error ||
            'Local Python reconstruction worker is starting up—run `npm run dev` or try an instant 3D model below.'
        );
      }
      const initialJob = ReconstructionJobSchema.parse(data);
      const uploadTitle = trimmedAddr || `Uploaded 3D Scan (${fileList.length} file${fileList.length > 1 ? 's' : ''})`;
      setJob(initialJob, uploadTitle);
      await pollJobUntilComplete(initialJob.jobId, uploadTitle);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      const friendly = raw.includes('fetch failed')
        ? 'Python reconstruction worker is offline. Run `npm run dev` (auto-bootstraps Python) or launch an instant 3D model below.'
        : raw || 'Upload reconstruction failed';
      setReconstructing(false, friendly);
    }
  };

  const handleAutoCalibrate = async () => {
    if (!sceneGroupRef.current || cameras.length === 0) {
      setCalibrating(false, 'Load a 3D mesh with camera metadata first.');
      return;
    }

    try {
      setCalibrating(true, null);
      let doorWorldBox:
        | { min: [number, number, number]; max: [number, number, number] }
        | undefined;
      sceneGroupRef.current.updateMatrixWorld(true);
      sceneGroupRef.current.traverse((obj) => {
        if (
          (obj as THREE.Mesh).isMesh &&
          obj.name.toLowerCase().includes('front_door')
        ) {
          const b = new THREE.Box3().setFromObject(obj);
          if (!b.isEmpty()) {
            doorWorldBox = {
              min: [b.min.x, b.min.y, b.min.z],
              max: [b.max.x, b.max.y, b.max.z],
            };
          }
        }
      });

      const resp = await fetch('/api/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job?.jobId,
          referenceImageUrl: job?.referenceImageUrl,
          camera: cameras[0],
          doorWorldBox,
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

  const captureNightScreenshot = useCallback((): string | null => {
    if (!screenshotFnRef.current) return null;
    try {
      return screenshotFnRef.current();
    } catch {
      return null;
    }
  }, []);

  const handleSceneReady = useCallback((group: THREE.Group) => {
    sceneGroupRef.current = group;
  }, []);

  const handleRegisterScreenshot = useCallback((fn: () => string) => {
    screenshotFnRef.current = fn;
  }, []);

  const showLauncher = sceneSource === 'NONE' || launcherModalOpen;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* 100% Full-Bleed 3D Spatial Viewport */}
      <div className="fixed inset-0">
        <StudioViewport
          onSceneReady={handleSceneReady}
          onRegisterScreenshot={handleRegisterScreenshot}
        />
      </div>

      {/* Active Studio Floating Glass Islands (Hidden on Initial Onboarding!) */}
      {sceneSource !== 'NONE' && (
        <>
          <header className="pointer-events-none fixed inset-x-4 top-4 z-20 flex flex-wrap items-start justify-between gap-3">
            {/* Top-Left Island: Brand + Active Building + Scale + Balcony Popover */}
            <div className="flex flex-col gap-2">
              <div
                style={{ backgroundColor: 'rgba(5, 8, 20, 0.92)' }}
                className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 px-3 py-2 shadow-2xl backdrop-blur-xl"
              >
                <div className="flex items-center gap-2 pr-1">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/35">
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                  <div className="max-w-[220px]">
                    <div className="truncate text-xs font-semibold text-white">
                      {sceneTitle || 'Lumen3D Studio'}
                    </div>
                  </div>
                </div>

                <div className="h-4 w-px bg-white/12" />

                <button
                  type="button"
                  data-testid="btn-change-building"
                  onClick={() => setLauncherModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-xl bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/[0.12]"
                >
                  <FolderOpen className="h-3 w-3 text-amber-300" />
                  Change Building
                </button>

                {activeBuildingSpec && sceneSource === 'MESH_RECON' && (
                  <button
                    type="button"
                    data-testid="btn-toggle-building-adjuster"
                    onClick={() => setIsAdjusterOpen((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-medium transition ${
                      isAdjusterOpen
                        ? 'bg-amber-400 text-slate-950 font-semibold'
                        : 'bg-white/[0.06] text-slate-200 hover:bg-white/[0.12]'
                    }`}
                  >
                    <Building2 className="h-3 w-3" />
                    Floors &amp; Balconies
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </button>
                )}

                <button
                  type="button"
                  data-testid="btn-toggle-scale"
                  onClick={() => setIsScaleOpen((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-medium transition ${
                    isScaleOpen
                      ? 'bg-white/20 text-white'
                      : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30 hover:bg-emerald-500/25'
                  }`}
                >
                  <Ruler className="h-3 w-3" />
                  {calibrationSource === 'MAPS_3D_TILES'
                    ? '1:1 Metric (3D Tiles)'
                    : calibrationSource === 'AUTO_DOOR'
                      ? 'Door Scale (6.67 ft)'
                      : 'Scale & Calibrate'}
                </button>
              </div>

              {isScaleOpen && (
                <div className="max-w-lg">
                  <CalibrationOverlay
                    feetPerSceneUnit={feetPerSceneUnit}
                    calibrationSource={calibrationSource}
                    toolMode={toolMode}
                    rulerPoints={rulerPoints}
                    isCalibrating={isCalibrating}
                    calibrationError={calibrationError}
                    hasScene={true}
                    onAutoCalibrate={handleAutoCalibrate}
                    onSetToolMode={setToolMode}
                    onClearRulerPoints={clearRulerPoints}
                    onApplyManualScale={(scale) =>
                      setCalibration(scale, 'MANUAL_RULER')
                    }
                  />
                </div>
              )}

              {isAdjusterOpen && activeBuildingSpec && (
                <div className="pointer-events-auto w-80 shadow-2xl">
                  <BuildingAdjuster
                    spec={activeBuildingSpec}
                    isReconstructing={isReconstructing}
                    onRebuildSpec={handleRebuildBuildingSpec}
                  />
                </div>
              )}
            </div>

            {/* Top-Center Island: Day / Dusk / Night Sky Switcher */}
            <div
              style={{ backgroundColor: 'rgba(5, 8, 20, 0.92)' }}
              className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/15 p-1 shadow-2xl backdrop-blur-xl"
            >
              {(
                [
                  { mode: 'DAY', label: 'Day', icon: <Sun className="h-3.5 w-3.5" /> },
                  {
                    mode: 'DUSK',
                    label: 'Dusk',
                    icon: <Sunset className="h-3.5 w-3.5" />,
                  },
                  {
                    mode: 'NIGHT',
                    label: 'Night',
                    icon: <Moon className="h-3.5 w-3.5" />,
                  },
                ] as Array<{
                  mode: LightingMode;
                  label: string;
                  icon: React.ReactNode;
                }>
              ).map((item) => {
                const active = lightingMode === item.mode;
                return (
                  <button
                    key={item.mode}
                    type="button"
                    data-testid={`lighting-${item.mode.toLowerCase()}`}
                    onClick={() => setLightingMode(item.mode)}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'bg-amber-400 font-semibold text-slate-950 shadow-sm'
                        : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                );
              })}
            </div>

            {/* Top-Right Island: On-Demand AI Co-Pilot & Shopping List Triggers */}
            <div
              style={{ backgroundColor: 'rgba(5, 8, 20, 0.92)' }}
              className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-white/15 p-1.5 shadow-2xl backdrop-blur-xl"
            >
              <button
                type="button"
                data-testid="btn-toggle-copilot"
                onClick={() =>
                  setActiveDrawer(activeDrawer === 'COPILOT' ? 'NONE' : 'COPILOT')
                }
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  activeDrawer === 'COPILOT'
                    ? 'bg-amber-400 font-semibold text-slate-950'
                    : 'text-slate-200 hover:bg-white/[0.08]'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                AI Co-Pilot
              </button>

              <button
                type="button"
                data-testid="btn-toggle-bom"
                onClick={() =>
                  setActiveDrawer(activeDrawer === 'BOM' ? 'NONE' : 'BOM')
                }
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  activeDrawer === 'BOM'
                    ? 'bg-amber-400 font-semibold text-slate-950'
                    : 'text-slate-200 hover:bg-white/[0.08]'
                }`}
              >
                <ShoppingBag className="h-3.5 w-3.5 text-emerald-300" />
                Shopping List
                {runs.length > 0 && (
                  <span className="rounded-full bg-amber-400/20 px-1.5 py-0.2 text-[10px] font-bold text-amber-300">
                    {runs.length}
                  </span>
                )}
              </button>
            </div>
          </header>

          {/* Bottom-Center Pascal-Style Floating Tool Dock */}
          <FloatingDock />

          {/* Responsive High-Contrast Dark Obsidian Telemetry Pill (single DOM instance; sits bottom-left clear of top popovers when right drawer opens) */}
          <div
            className={`pointer-events-none fixed z-20 w-[330px] max-w-[calc(100vw-2rem)] transition-all ${
              activeDrawer !== 'NONE'
                ? 'bottom-24 left-4'
                : 'right-4 top-16 xl:bottom-5 xl:right-4 xl:top-auto'
            }`}
          >
            <TelemetryHUD telemetry={telemetry} />
          </div>

          {/* Google Maps Attribution & Warnings Chip (for non-Tile Maps context) */}
          {sceneSource !== 'MAPS_3D_TILES' &&
            (mapsAttribution || mapsWarnings.length > 0) && (
              <div
                data-testid="maps-attribution-badge"
                style={{ backgroundColor: 'rgba(5, 8, 20, 0.9)' }}
                className="pointer-events-none fixed bottom-5 left-5 z-10 max-w-xs rounded-xl border border-white/15 px-3 py-1.5 text-[10px] text-slate-300 backdrop-blur-md"
              >
                {mapsAttribution && (
                  <p className="font-medium text-sky-300">
                    Google Maps · {mapsAttribution}
                  </p>
                )}
                {mapsWarnings.map((w, idx) => (
                  <p key={idx} className="text-amber-300">
                    {w}
                  </p>
                ))}
              </div>
            )}

          {/* Slide-Over AI Critique & Hardware BOM Drawer (only mounted when open!) */}
          <CopilotDrawer
            telemetry={telemetry}
            captureNightScreenshot={captureNightScreenshot}
          />
        </>
      )}

      {/* Centered Progressive Onboarding / Building Switcher Modal */}
      {showLauncher && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]">
          <StudioLauncher
            streetAddress={streetAddress}
            onChangeAddress={setStreetAddress}
            onSubmitAddress={handleSubmitAddress}
            onUploadFiles={handleUploadFiles}
            onLoadSample={handleLoadSamplePreset}
            isBusy={isReconstructing}
            guideMessage={launcherGuide}
            errorMessage={reconError}
            canDismiss={sceneSource !== 'NONE'}
            onDismiss={() => setLauncherModalOpen(false)}
          />
        </div>
      )}

      {/* Clean Progress Overlay During Multi-View Reconstruction */}
      {isReconstructing && sceneSource !== 'NONE' && !launcherModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/65 backdrop-blur-sm">
          <div
            style={{ backgroundColor: 'rgba(7, 11, 22, 0.95)' }}
            className="rounded-2xl border border-white/15 px-7 py-5 text-center shadow-2xl"
          >
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-amber-400" />
            <p className="mt-3 text-sm font-semibold text-white">
              Updating 3D Building…
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {job ? `${job.progress}% (${job.mode})` : 'Preparing geometry'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
