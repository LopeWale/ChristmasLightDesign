'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Camera,
  CheckCircle2,
  Compass,
  Cpu,
  Loader2,
  Smartphone,
  Sparkles,
  Upload,
  Zap,
} from 'lucide-react';
import {
  LiveScanSessionSchema,
  type LiveScanSession,
  type ScanAngleSector,
} from '@lumen3d/shared-schemas';

const WALKAROUND_SECTORS: Array<{
  id: ScanAngleSector;
  shortLabel: string;
  hint: string;
}> = [
  { id: 'left_side', shortLabel: 'Left Wall', hint: '90° left elevation' },
  { id: 'front_left', shortLabel: '45° Left', hint: 'Front-left oblique corner' },
  { id: 'front', shortLabel: 'Front', hint: 'Primary street elevation' },
  { id: 'front_right', shortLabel: '45° Right', hint: 'Front-right oblique corner' },
  { id: 'right_side', shortLabel: 'Right Wall', hint: '90° right / garage side' },
];

function computeCanvasSharpness(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap =
        gray[idx - w] +
        gray[idx + w] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

export default function MobileLiveScannerPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = String(params?.sessionId || '');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadingRef = useRef<boolean>(false);
  const lastAutoCaptureYawRef = useRef<number | null>(null);
  const lastAutoCaptureMsRef = useRef<number>(0);

  const [session, setSession] = useState<LiveScanSession | null>(null);
  const [selectedSector, setSelectedSector] = useState<ScanAngleSector | 'auto'>('auto');
  const [cameraMode, setCameraMode] = useState<'starting' | 'live_stream' | 'native_capture'>('starting');
  const [autoShutter, setAutoShutter] = useState<boolean>(true);
  const [focusScore, setFocusScore] = useState<number>(0);
  const [yawDeg, setYawDeg] = useState<number | null>(null);
  const [needsCompassPermission, setNeedsCompassPermission] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 1. Load initial scan session metadata
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    fetch(`/api/scan/sessions/${encodeURIComponent(sessionId)}`, {
      cache: 'no-store',
    })
      .then(async (r) => {
        if (!r.ok) throw new Error('Scan session not found or expired.');
        const parsed = LiveScanSessionSchema.parse(await r.json());
        if (active) setSession(parsed);
      })
      .catch((err) => {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : 'Unable to connect to scan session');
        }
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  // 2. Start live rear camera stream when secure context supports getUserMedia; otherwise switch cleanly to native OS camera capture
  useEffect(() => {
    let cancelled = false;
    if (
      typeof window === 'undefined' ||
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCameraMode('native_capture');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setCameraMode('live_stream');
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setCameraMode('native_capture');
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // 3. DeviceOrientation compass listener for automatic walkaround sector tracking
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const DevOrient = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof DevOrient?.requestPermission === 'function') {
      setNeedsCompassPermission(true);
    }

    const onOrientation = (e: DeviceOrientationEvent) => {
      const webkitHeading = (e as unknown as { webkitCompassHeading?: number })
        .webkitCompassHeading;
      if (typeof webkitHeading === 'number' && Number.isFinite(webkitHeading)) {
        setYawDeg(webkitHeading);
      } else if (typeof e.alpha === 'number' && Number.isFinite(e.alpha)) {
        setYawDeg((360 - e.alpha) % 360);
      }
    };
    window.addEventListener('deviceorientation', onOrientation, true);
    return () => window.removeEventListener('deviceorientation', onOrientation, true);
  }, []);

  const requestIosCompass = async () => {
    try {
      const DevOrient = window.DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };
      if (typeof DevOrient?.requestPermission === 'function') {
        const res = await DevOrient.requestPermission();
        if (res === 'granted') setNeedsCompassPermission(false);
      }
    } catch {
      setNeedsCompassPermission(false);
    }
  };

  const uploadFrameBlob = useCallback(
    async (blob: Blob, sectorOverride?: ScanAngleSector | 'auto') => {
      if (!sessionId || uploadingRef.current) return;
      uploadingRef.current = true;
      setIsUploading(true);
      setErrorMsg(null);
      try {
        const form = new FormData();
        form.append('file', blob, `scan_${Date.now()}.jpg`);
        form.append('sector', sectorOverride ?? selectedSector);
        if (yawDeg !== null) {
          form.append('yawDeg', yawDeg.toFixed(1));
        }

        const resp = await fetch(
          `/api/scan/sessions/${encodeURIComponent(sessionId)}/frames`,
          {
            method: 'POST',
            body: form,
          }
        );
        const raw = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(raw.error || 'Frame upload failed');
        }
        const updated = LiveScanSessionSchema.parse(raw);
        setSession(updated);
        if (yawDeg !== null) {
          lastAutoCaptureYawRef.current = yawDeg;
        }
        lastAutoCaptureMsRef.current = Date.now();
        // Reset explicit sector pill back to auto after manual sector capture
        if (selectedSector !== 'auto' && updated.coveredSectors.includes(selectedSector)) {
          setSelectedSector('auto');
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        uploadingRef.current = false;
        setIsUploading(false);
      }
    },
    [selectedSector, sessionId, yawDeg]
  );

  const captureFromLiveVideo = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth < 32 || video.videoHeight < 32) return;
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
    );
    if (blob) {
      await uploadFrameBlob(blob);
    }
  }, [uploadFrameBlob]);

  // 4. Periodic focus meter + hands-free compass auto-shutter loop
  useEffect(() => {
    if (cameraMode !== 'live_stream') return;
    const probeCanvas = document.createElement('canvas');
    probeCanvas.width = 160;
    probeCanvas.height = 120;
    const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true });

    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || !probeCtx || video.readyState < 2 || video.videoWidth === 0) {
        return;
      }
      probeCtx.drawImage(video, 0, 0, 160, 120);
      const sharp = computeCanvasSharpness(probeCtx, 160, 120);
      setFocusScore(Math.round(sharp));

      if (!autoShutter || uploadingRef.current || sharp < 34) return;
      const now = Date.now();
      if (now - lastAutoCaptureMsRef.current < 3200) return;

      const coveredCount = session?.coveredSectors.length ?? 0;
      if (coveredCount === 0) {
        void captureFromLiveVideo();
        return;
      }

      if (yawDeg !== null && lastAutoCaptureYawRef.current !== null) {
        const rawDiff = Math.abs(yawDeg - lastAutoCaptureYawRef.current) % 360;
        const shortestArc = rawDiff > 180 ? 360 - rawDiff : rawDiff;
        if (shortestArc >= 28 && coveredCount < 5) {
          void captureFromLiveVideo();
        }
      }
    }, 450);

    return () => clearInterval(timer);
  }, [autoShutter, cameraMode, captureFromLiveVideo, session?.coveredSectors.length, yawDeg]);

  const coveredSet = new Set<ScanAngleSector>(session?.coveredSectors ?? []);
  const nextUncoveredSector =
    WALKAROUND_SECTORS.find((s) => !coveredSet.has(s.id))?.id ?? 'front';

  return (
    <div
      data-testid="mobile-live-scanner"
      className="flex min-h-[100dvh] flex-col justify-between bg-slate-950 text-slate-100"
    >
      {/* Top Header Bar */}
      <header className="z-20 border-b border-white/10 bg-slate-950/90 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/35">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <div className="text-xs font-semibold text-white">
                Lumen3D Live Walkaround Scanner
              </div>
              <div className="text-[11px] text-slate-400">
                {session?.address || `Session ${sessionId}`}
                {session?.targetHeightMeters
                  ? ` · Solar Height Lock ${session.targetHeightMeters.toFixed(1)}m`
                  : ''}
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
            <Cpu className="h-3 w-3" />
            {coveredSet.size}/5 Angles
          </span>
        </div>

        {/* 5-Sector Walkaround Arc Selector */}
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {WALKAROUND_SECTORS.map((sec) => {
            const done = coveredSet.has(sec.id);
            const active = selectedSector === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                data-testid={`sector-pill-${sec.id}`}
                onClick={() =>
                  setSelectedSector((cur) => (cur === sec.id ? 'auto' : sec.id))
                }
                className={`flex flex-col items-center justify-center rounded-xl border px-1.5 py-1.5 text-[10px] font-medium transition ${
                  done
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                    : active
                      ? 'border-amber-400 bg-amber-400/20 text-amber-200'
                      : 'border-white/10 bg-white/[0.04] text-slate-400'
                }`}
              >
                <span className="truncate font-semibold">{sec.shortLabel}</span>
                <span className="mt-0.5 text-[9px] opacity-80">
                  {done ? '✓ Synced' : active ? 'Target' : 'Open'}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Viewfinder or Native OS Camera Trigger */}
      <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-slate-900/60 px-4 py-4">
        {cameraMode === 'live_stream' ? (
          <div className="relative h-full w-full max-w-lg overflow-hidden rounded-3xl border border-white/15 bg-black shadow-2xl">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-[54dvh] w-full object-cover"
            />
            {/* Architectural Framing Reticle */}
            <div className="pointer-events-none absolute inset-5 rounded-2xl border border-dashed border-amber-300/45" />

            {/* Live Focus + Gyro Telemetry Chips */}
            <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2 text-[11px]">
              <span
                className={`rounded-full px-2.5 py-1 font-medium backdrop-blur-md ${
                  focusScore >= 30
                    ? 'bg-emerald-950/85 text-emerald-300 ring-1 ring-emerald-400/35'
                    : 'bg-amber-950/85 text-amber-200 ring-1 ring-amber-400/35'
                }`}
              >
                Focus {focusScore} · {focusScore >= 30 ? 'Crisp' : 'Hold Steady'}
              </span>
              {yawDeg !== null ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-950/85 px-2.5 py-1 text-sky-300 ring-1 ring-white/15 backdrop-blur-md">
                  <Compass className="h-3 w-3" />
                  {Math.round(yawDeg)}°
                </span>
              ) : needsCompassPermission ? (
                <button
                  type="button"
                  onClick={requestIosCompass}
                  className="inline-flex items-center gap-1 rounded-full bg-sky-500/25 px-2.5 py-1 font-medium text-sky-200 ring-1 ring-sky-400/40 backdrop-blur-md"
                >
                  <Compass className="h-3 w-3" />
                  Enable Gyro Auto-Angle
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="w-full max-w-md rounded-3xl border border-white/15 bg-slate-950/90 p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/35">
              <Smartphone className="h-6 w-6" />
            </div>
            <h2 className="mt-3 text-base font-semibold text-white">
              1-Tap Native Camera Capture
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Snap each exterior angle below — every photo streams straight to your
              desktop 3D Studio and updates the live textured mesh &amp; Gaussian splat
              within 1 second.
            </p>

            <button
              type="button"
              data-testid="btn-native-camera-snap"
              disabled={isUploading}
              onClick={() => {
                if (selectedSector === 'auto') {
                  setSelectedSector(nextUncoveredSector);
                }
                nativeCameraInputRef.current?.click();
              }}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 px-5 py-3.5 text-sm font-semibold text-slate-950 shadow-lg transition hover:bg-amber-300 disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Fusing 3D Angle…
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4" />
                  Snap{' '}
                  {
                    WALKAROUND_SECTORS.find(
                      (s) =>
                        s.id ===
                        (selectedSector === 'auto'
                          ? nextUncoveredSector
                          : selectedSector)
                    )?.shortLabel
                  }{' '}
                  Photo
                </>
              )}
            </button>
          </div>
        )}

        {/* Hidden Native Camera / File Input (always available as fallback or upload) */}
        <input
          ref={nativeCameraInputRef}
          data-testid="input-mobile-camera-file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              const targetSec =
                selectedSector === 'auto' ? nextUncoveredSector : selectedSector;
              await uploadFrameBlob(file, targetSec);
              e.target.value = '';
            }
          }}
          className="hidden"
        />
      </main>

      {/* Guidance & Shutter Controls Footer */}
      <footer className="z-20 border-t border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur-xl">
        <div
          data-testid="scanner-guidance-banner"
          className="mb-3 flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs text-slate-200"
        >
          <span className="leading-snug">
            {errorMsg ? (
              <span className="text-rose-300">{errorMsg}</span>
            ) : (
              session?.guidanceMessage ||
              'Point at your Front Elevation first, then walk 45° left and right.'
            )}
          </span>
          {coveredSet.size >= 3 && (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          )}
        </div>

        {cameraMode === 'live_stream' && (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setAutoShutter((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                autoShutter
                  ? 'border-amber-400/40 bg-amber-400/15 text-amber-200'
                  : 'border-white/15 bg-white/[0.05] text-slate-300'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              Auto-Shutter {autoShutter ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              data-testid="btn-capture-scan-frame"
              disabled={isUploading}
              onClick={captureFromLiveVideo}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-amber-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg transition hover:bg-amber-300 disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Syncing to Desktop…
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4" />
                  Capture Keyframe
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => nativeCameraInputRef.current?.click()}
              aria-label="Upload high-res photo"
              className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/[0.05] p-2.5 text-slate-200 hover:bg-white/10"
            >
              <Upload className="h-4 w-4" />
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
