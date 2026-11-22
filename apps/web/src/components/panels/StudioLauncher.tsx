'use client';

import React, { useRef, useState } from 'react';
import {
  Sparkles,
  MapPin,
  ArrowRight,
  UploadCloud,
  Building2,
  Home,
  Loader2,
  Layers,
  Cpu,
  QrCode,
  Camera,
  X,
} from 'lucide-react';

export interface StudioLauncherProps {
  streetAddress: string;
  onChangeAddress: (value: string) => void;
  onSubmitAddress: (address: string) => Promise<void>;
  onUploadFiles: (files: FileList, reconMode: 'auto' | 'da3') => Promise<void>;
  onStartLiveScan?: () => Promise<void>;
  onLoadSample: (preset: 'condo' | 'house') => Promise<void>;
  isBusy: boolean;
  progressPercent?: number | null;
  guideMessage: string | null;
  errorMessage: string | null;
  canDismiss?: boolean;
  onDismiss?: () => void;
}

export function StudioLauncher({
  streetAddress,
  onChangeAddress,
  onSubmitAddress,
  onUploadFiles,
  onStartLiveScan,
  onLoadSample,
  isBusy,
  progressPercent = null,
  guideMessage,
  errorMessage,
  canDismiss = false,
  onDismiss,
}: StudioLauncherProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reconMode, setReconMode] = useState<'auto' | 'da3'>('auto');
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!streetAddress.trim() || isBusy) return;
    await onSubmitAddress(streetAddress);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await onUploadFiles(e.dataTransfer.files, reconMode);
    }
  };

  return (
    <div
      data-testid="studio-launcher"
      style={{ backgroundColor: 'rgba(7, 11, 22, 0.94)' }}
      className="pointer-events-auto relative w-full max-w-xl rounded-3xl border border-white/15 p-7 text-slate-100 shadow-[0_32px_90px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
    >
      {canDismiss && onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close launcher"
          className="absolute right-5 top-5 rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {/* Brand & Clear Value Proposition */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/35">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-300/90">
            Lumen3D Spatial Studio
          </span>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            Load your condo or home in 3D
          </h1>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        Stream your real building via Google Photorealistic 3D Tiles, drop a phone
        walkaround video/photo scan, or start from an instant 3D condo or house.
      </p>

      {/* 1. Primary Street Address Search Form */}
      <form onSubmit={handleFormSubmit} className="mt-5">
        <label
          htmlFor="launcher-address-input"
          className="mb-1.5 block text-[11px] font-medium text-slate-300"
        >
          1. Find by Street Address
        </label>
        <div className="flex items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.04] p-1.5 focus-within:border-amber-400/60 focus-within:bg-white/[0.06]">
          <MapPin className="ml-2.5 h-4 w-4 shrink-0 text-amber-300" />
          <input
            id="launcher-address-input"
            type="text"
            data-testid="input-street-address"
            value={streetAddress}
            onChange={(e) => onChangeAddress(e.target.value)}
            placeholder="1007 N Shartel Ave, Oklahoma City, OK"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            data-testid="btn-lookup-address"
            disabled={isBusy || !streetAddress.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-400 px-4 py-2 text-xs font-semibold text-slate-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                Load 3D
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Actionable Guide Banner (when Map Tiles API needs enabling or key missing) */}
      {guideMessage && (
        <div
          data-testid="launcher-maps-guide"
          className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3.5 text-xs text-amber-100"
        >
          <p className="leading-relaxed">{guideMessage}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-[11px] font-semibold text-slate-950 hover:bg-amber-300"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              Attach Facade Photo / Video
            </button>
            <button
              type="button"
              data-testid="btn-guide-open-condo"
              onClick={() => onLoadSample('condo')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-white/15"
            >
              <Building2 className="h-3.5 w-3.5" />
              Open 3-Story Condo Template
            </button>
          </div>
        </div>
      )}

      {isBusy && progressPercent !== null && (
        <div
          data-testid="launcher-progress"
          className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs text-amber-100"
        >
          <div className="flex items-center justify-between font-medium">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />
              Reconstructing 3D exterior…
            </span>
            <span className="tabular-nums text-amber-200">
              {Math.round(progressPercent)}%
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-amber-400 transition-all duration-200"
              style={{ width: `${Math.max(8, Math.min(100, progressPercent))}%` }}
            />
          </div>
        </div>
      )}

      {errorMessage && (
        <div
          data-testid="launcher-error"
          className="mt-3 rounded-xl border border-rose-500/35 bg-rose-950/60 px-3.5 py-2.5 text-xs text-rose-200"
        >
          {errorMessage}
        </div>
      )}

      {/* 2. Drag-and-Drop Walkaround Photos / Video */}
      <div className="mt-4">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-slate-300">
            2. Or Reconstruct from Photos / Walkaround Video
          </span>
          <div
            role="group"
            aria-label="Reconstruction engine"
            className="inline-flex shrink-0 rounded-lg border border-white/10 bg-white/[0.04] p-0.5 text-[10px]"
          >
            <button
              type="button"
              data-testid="mode-architectural"
              onClick={() => setReconMode('auto')}
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 font-medium transition ${
                reconMode === 'auto'
                  ? 'bg-white/15 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="h-3 w-3" />
              Architectural 3D
            </button>
            <button
              type="button"
              data-testid="mode-da3"
              onClick={() => setReconMode('da3')}
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 font-medium transition ${
                reconMode === 'da3'
                  ? 'bg-amber-400/20 text-amber-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu className="h-3 w-3" />
              Neural Depth + Splat
            </button>
          </div>
        </div>

        <button
          type="button"
          data-testid="btn-upload-media"
          disabled={isBusy}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex w-full items-center justify-between rounded-2xl border border-dashed px-4 py-3.5 text-left transition ${
            isDragOver
              ? 'border-amber-400 bg-amber-400/10'
              : 'border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.05]'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-slate-200">
              <UploadCloud className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-100">
                Drop exterior photos or MP4/MOV walkaround video
              </div>
              <div className="text-[11px] text-slate-400">
                {streetAddress.trim()
                  ? `Will fuse with "${streetAddress.trim()}" footprint`
                  : 'Extracts stories, balconies, rooflines & facade colors'}
              </div>
            </div>
          </div>
          <span className="rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-slate-200">
            Browse
          </span>
        </button>

        {onStartLiveScan && (
          <button
            type="button"
            data-testid="btn-start-live-scan"
            disabled={isBusy}
            onClick={() => void onStartLiveScan()}
            className="mt-2.5 flex w-full items-center justify-between rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.08] px-4 py-3 text-left transition hover:border-emerald-400/55 hover:bg-emerald-500/[0.14] disabled:opacity-50"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/35">
                <Camera className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-100">
                  Live Walkaround Camera Scan (Phone QR)
                  <span className="rounded-full bg-emerald-400/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                    Real-Time 3DGS
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Scan QR with your phone &amp; watch multi-wall 3D mesh + SparkJS splats build live
                </div>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/35 bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
              <QrCode className="h-3.5 w-3.5" />
              Pair Phone
            </span>
          </button>
        )}

        <input
          ref={fileInputRef}
          data-testid="input-upload-files"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
          onChange={async (e) => {
            if (e.target.files && e.target.files.length > 0) {
              await onUploadFiles(e.target.files, reconMode);
              e.target.value = '';
            }
          }}
          className="hidden"
        />
      </div>

      {/* 3. Instant 1-Click Sample Starters */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">
            No address or photos handy? Try a ready-made 3D building:
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="btn-load-sample-condo"
              disabled={isBusy}
              onClick={() => onLoadSample('condo')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/35 bg-amber-400/15 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-400/25 disabled:opacity-50"
            >
              <Building2 className="h-3.5 w-3.5" />
              3-Story Condo (2 Balconies)
            </button>
            <button
              type="button"
              data-testid="btn-load-sample-house"
              disabled={isBusy}
              onClick={() => onLoadSample('house')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/[0.1] disabled:opacity-50"
            >
              <Home className="h-3.5 w-3.5" />
              Suburban House
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
