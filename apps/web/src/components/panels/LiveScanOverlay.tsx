'use client';

import React, { useState } from 'react';
import {
  Camera,
  Check,
  Copy,
  Cpu,
  ExternalLink,
  Loader2,
  QrCode,
  Radio,
  X,
} from 'lucide-react';
import type { ScanAngleSector } from '@lumen3d/shared-schemas';
import type { LiveScanSessionWithQr } from '@/lib/scan/scanProxy';

const SECTOR_ORDER: Array<{ id: ScanAngleSector; label: string }> = [
  { id: 'left_side', label: 'Left Wall' },
  { id: 'front_left', label: '45° Left' },
  { id: 'front', label: 'Front' },
  { id: 'front_right', label: '45° Right' },
  { id: 'right_side', label: 'Right Wall' },
];

export interface LiveScanOverlayProps {
  session: LiveScanSessionWithQr;
  onCloseScan: () => void;
}

export function LiveScanOverlay({
  session,
  onCloseScan,
}: LiveScanOverlayProps) {
  const [copied, setCopied] = useState(false);
  const [showFloatingQr, setShowFloatingQr] = useState(false);

  const coveredSet = new Set<ScanAngleSector>(session.coveredSectors);
  const hasGeometry = Boolean(session.latestJob?.glbUrl);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(session.mobileScanUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors in restricted contexts
    }
  };

  // Phase A: Waiting for first camera keyframe -> Centered Phone QR Pairing Modal
  if (!hasGeometry) {
    return (
      <div
        data-testid="live-scan-modal"
        className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm"
      >
        <div
          style={{ backgroundColor: 'rgba(7, 11, 22, 0.96)' }}
          className="relative w-full max-w-lg rounded-3xl border border-white/15 p-6 text-slate-100 shadow-[0_32px_90px_rgba(0,0,0,0.85)]"
        >
          <button
            type="button"
            onClick={onCloseScan}
            aria-label="Cancel live camera scan"
            className="absolute right-5 top-5 rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/35">
              <Camera className="h-4 w-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-300">
                  Live Multi-View Scanner
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-400/30">
                  <Cpu className="h-2.5 w-2.5" />
                  SparkJS 3DGS
                </span>
              </div>
              <h2 className="text-base font-semibold text-white">
                Scan QR with your phone &amp; walk around your exterior
              </h2>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 items-center gap-5 sm:grid-cols-[190px_1fr]">
            <div className="mx-auto flex flex-col items-center rounded-2xl bg-white p-2.5 shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                data-testid="live-scan-qr-image"
                src={session.qrCodeDataUrl}
                alt="Scan QR code to open mobile walkaround camera"
                className="h-40 w-40 rounded-lg"
              />
            </div>

            <div className="space-y-3 text-xs">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-slate-300">
                <div className="flex items-center gap-2 font-medium text-amber-200">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                  Waiting for anchor Front Elevation frame…
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                  Stand across the driveway facing the front of your home or condo,
                  then walk 45° left &amp; right. Your 3D building + Gaussian splats
                  will stream onto this canvas live.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-white/12"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? 'Copied URL' : 'Copy Phone Link'}
                </button>

                <a
                  href={`/scan/${encodeURIComponent(session.sessionId)}`}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="link-open-desktop-webcam-scanner"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400/15 px-3 py-1.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-400/35 hover:bg-amber-400/25"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Use Webcam / New Tab
                </a>
              </div>

              <p className="text-[10px] leading-relaxed text-slate-500">
                Tip: Same Wi-Fi required. Run <code className="text-slate-300">npm run dev:https</code>{' '}
                for live iOS Safari video auto-shutter, or standard HTTP for 1-tap native camera snaps.
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-5 gap-1.5 border-t border-white/10 pt-4">
            {SECTOR_ORDER.map((sec) => (
              <div
                key={sec.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-1.5 text-center text-[10px] text-slate-400"
              >
                {sec.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Phase B: Geometry is live in the 3D Viewport! Dock a non-blocking Live Sync HUD Pill
  return (
    <div
      data-testid="live-scan-hud-pill"
      style={{ backgroundColor: 'rgba(5, 8, 20, 0.93)' }}
      className="pointer-events-auto fixed left-4 top-20 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-emerald-400/35 p-3.5 text-xs text-slate-100 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <span className="font-semibold text-emerald-300">
            Live Camera Sync ({coveredSet.size}/5 angles)
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowFloatingQr((v) => !v)}
            aria-label="Toggle QR code"
            className="rounded-lg border border-white/15 bg-white/[0.06] p-1 text-slate-300 hover:text-white"
          >
            <QrCode className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="btn-finish-live-scan"
            onClick={onCloseScan}
            className="rounded-lg bg-emerald-400 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-emerald-300"
          >
            Done
          </button>
        </div>
      </div>

      <p className="mt-1.5 text-[11px] text-slate-300">
        {session.guidanceMessage}
      </p>

      <div className="mt-2.5 grid grid-cols-5 gap-1">
        {SECTOR_ORDER.map((sec) => {
          const done = coveredSet.has(sec.id);
          return (
            <div
              key={sec.id}
              className={`rounded-lg px-1 py-1 text-center text-[9px] font-semibold ${
                done
                  ? 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/40'
                  : 'bg-white/[0.04] text-slate-500'
              }`}
            >
              {done ? `✓ ${sec.label}` : sec.label}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
        <span className="inline-flex items-center gap-1">
          <Radio className="h-3 w-3 text-amber-300" />
          Frames: {session.frames.length} · {session.neuralBackendUsed}
        </span>
      </div>

      {showFloatingQr && (
        <div className="mt-3 flex flex-col items-center rounded-xl bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={session.qrCodeDataUrl}
            alt="Mobile scanner QR"
            className="h-32 w-32"
          />
        </div>
      )}
    </div>
  );
}
