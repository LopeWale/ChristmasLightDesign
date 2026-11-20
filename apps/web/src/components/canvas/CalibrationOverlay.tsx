'use client';

import React, { useState } from 'react';
import { Ruler, Sparkles, CheckCircle2, X } from 'lucide-react';
import type { CalibrationSource, ToolMode, Vec3 } from '@lumen3d/shared-schemas';
import { computeManualRulerScale } from '@/lib/geometry/raycastCalibration';

export interface CalibrationOverlayProps {
  feetPerSceneUnit: number;
  calibrationSource: CalibrationSource;
  toolMode: ToolMode;
  rulerPoints: Vec3[];
  isCalibrating: boolean;
  calibrationError: string | null;
  hasScene: boolean;
  onAutoCalibrate: () => void;
  onSetToolMode: (mode: ToolMode) => void;
  onClearRulerPoints: () => void;
  onApplyManualScale: (feetPerSceneUnit: number) => void;
}

function formatBadgeText(source: CalibrationSource, feetPerUnit: number): string {
  const ratio = `${feetPerUnit.toFixed(2)} ft/unit`;
  switch (source) {
    case 'AUTO_DOOR':
      return `Auto-calibrated via Front Door: 6.67 ft (${ratio})`;
    case 'AUTO_GARAGE':
      return `Auto-calibrated via Garage Door: 7.00 ft (${ratio})`;
    case 'MANUAL_RULER':
      return `Calibrated via 2-Click Ruler (${ratio})`;
    case 'DEFAULT':
    default:
      return `Metric Default Scale (${ratio})`;
  }
}

export function CalibrationOverlay({
  feetPerSceneUnit,
  calibrationSource,
  toolMode,
  rulerPoints,
  isCalibrating,
  calibrationError,
  hasScene,
  onAutoCalibrate,
  onSetToolMode,
  onClearRulerPoints,
  onApplyManualScale,
}: CalibrationOverlayProps) {
  const [feetInput, setFeetInput] = useState<string>('6');
  const [inchesInput, setInchesInput] = useState<string>('8');
  const [localError, setLocalError] = useState<string | null>(null);

  if (!hasScene) return null;

  const isRulerActive = toolMode === 'CALIBRATE_RULER';
  const hasTwoPoints = rulerPoints.length >= 2;

  const handleApplyManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasTwoPoints) return;
    const ft = Number(feetInput) || 0;
    const inc = Number(inchesInput) || 0;
    const totalFeet = ft + inc / 12.0;
    try {
      const nextScale = computeManualRulerScale(
        rulerPoints[0],
        rulerPoints[1],
        totalFeet
      );
      setLocalError(null);
      onApplyManualScale(nextScale);
      onClearRulerPoints();
      onSetToolMode('SELECT');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Invalid ruler measurement');
    }
  };

  return (
    <div
      data-testid="calibration-overlay"
      className="pointer-events-auto flex flex-col gap-2 rounded-xl border border-slate-700/80 bg-slate-950/85 px-3.5 py-2.5 text-xs text-slate-200 shadow-xl backdrop-blur-md"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <span data-testid="calibration-status-badge">
            {formatBadgeText(calibrationSource, feetPerSceneUnit)}
          </span>
        </span>

        <button
          type="button"
          data-testid="btn-auto-calibrate"
          disabled={isCalibrating}
          onClick={onAutoCalibrate}
          className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1 font-medium text-amber-300 ring-1 ring-amber-400/40 transition hover:bg-amber-500/30 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {isCalibrating ? 'Calibrating…' : 'Auto-Calibrate (Gemini)'}
        </button>

        <button
          type="button"
          data-testid="btn-manual-ruler"
          onClick={() => {
            onClearRulerPoints();
            onSetToolMode(isRulerActive ? 'SELECT' : 'CALIBRATE_RULER');
          }}
          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium transition ${
            isRulerActive
              ? 'bg-sky-500 text-slate-950'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          <Ruler className="h-3.5 w-3.5" />
          {isRulerActive ? 'Cancel Ruler' : '2-Click Ruler'}
        </button>
      </div>

      {isRulerActive && !hasTwoPoints && (
        <div className="rounded-lg bg-sky-950/70 px-2.5 py-1.5 text-[11px] text-sky-200 ring-1 ring-sky-500/30">
          {rulerPoints.length === 0
            ? 'Step 1/2: Click the first reference point on the 3D facade (e.g., bottom of door or column).'
            : 'Step 2/2: Click the second reference point on the 3D facade to measure span.'}
        </div>
      )}

      {isRulerActive && hasTwoPoints && (
        <form
          onSubmit={handleApplyManual}
          className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-900/95 p-2 ring-1 ring-sky-500/40"
        >
          <span className="text-[11px] font-medium text-sky-300">Real distance:</span>
          <label className="flex items-center gap-1">
            <input
              type="number"
              min="0"
              step="1"
              value={feetInput}
              onChange={(e) => setFeetInput(e.target.value)}
              data-testid="input-ruler-feet"
              className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-100"
            />
            <span className="text-slate-400">ft</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="number"
              min="0"
              max="11.9"
              step="0.5"
              value={inchesInput}
              onChange={(e) => setInchesInput(e.target.value)}
              data-testid="input-ruler-inches"
              className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-100"
            />
            <span className="text-slate-400">in</span>
          </label>
          <button
            type="submit"
            data-testid="btn-apply-ruler-scale"
            className="rounded bg-sky-500 px-2.5 py-1 font-semibold text-slate-950 hover:bg-sky-400"
          >
            Apply Scale
          </button>
          <button
            type="button"
            onClick={onClearRulerPoints}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Reset points"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      )}

      {(calibrationError || localError) && (
        <p className="text-[11px] text-rose-400">{calibrationError || localError}</p>
      )}
    </div>
  );
}
