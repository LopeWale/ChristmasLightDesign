'use client';

import React from 'react';
import { Zap, Ruler, Lightbulb, AlertTriangle, ArrowUpFromLine } from 'lucide-react';
import type { DesignTelemetry } from '@lumen3d/shared-schemas';
import { NEC_15A_CONTINUOUS_WATTS_LIMIT } from '@/lib/geometry/bomMath';

export interface TelemetryHUDProps {
  telemetry: DesignTelemetry;
}

export function TelemetryHUD({ telemetry }: TelemetryHUDProps) {
  const { totals } = telemetry;
  const capacityWatts =
    totals.gfci15ACircuitsNeeded * NEC_15A_CONTINUOUS_WATTS_LIMIT;
  const loadPct = Math.min(
    100,
    capacityWatts > 0 ? (totals.totalWatts / capacityWatts) * 100 : 0
  );

  const barColor =
    loadPct >= 90
      ? 'bg-rose-500'
      : loadPct >= 70
        ? 'bg-amber-400'
        : 'bg-emerald-400';

  return (
    <div
      data-testid="telemetry-hud"
      style={{ backgroundColor: 'rgba(5, 8, 20, 0.94)' }}
      className="pointer-events-auto flex flex-col gap-2 rounded-2xl border border-white/15 px-4 py-3 text-xs text-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.72)] backdrop-blur-xl"
    >
      <div className="grid grid-cols-4 gap-3.5">
        <div>
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            <Ruler className="h-3 w-3 text-amber-300" />
            Length
          </div>
          <div
            data-testid="telemetry-total-feet"
            className="mt-0.5 text-sm font-bold tabular-nums text-white"
          >
            {totals.totalLengthFeet.toFixed(1)} ft
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            <Lightbulb className="h-3 w-3 text-amber-300" />
            Bulbs
          </div>
          <div
            data-testid="telemetry-total-bulbs"
            className="mt-0.5 text-sm font-bold tabular-nums text-white"
          >
            {totals.totalBulbs}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            <Zap className="h-3 w-3 text-emerald-400" />
            Load
          </div>
          <div
            data-testid="telemetry-total-watts"
            className="mt-0.5 text-sm font-bold tabular-nums text-white"
          >
            {totals.totalWatts.toFixed(1)}W
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            <ArrowUpFromLine className="h-3 w-3 text-sky-300" />
            Peak / Ladder
          </div>
          <div
            data-testid="telemetry-ladder"
            className="mt-0.5 text-sm font-bold tabular-nums text-white"
          >
            {totals.maxHeightFeet.toFixed(1)}ft /{' '}
            {totals.recommendedLadderFeet > 0
              ? `${totals.recommendedLadderFeet}ft`
              : '—'}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-[10px]">
          <span className="text-slate-400">
            NEC 15A GFCI (1,440W continuous)
          </span>
          <span
            data-testid="telemetry-circuits"
            className="font-semibold text-emerald-300"
          >
            {totals.gfci15ACircuitsNeeded}{' '}
            {totals.gfci15ACircuitsNeeded === 1 ? 'Circuit' : 'Circuits'} (
            {loadPct.toFixed(1)}%)
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full transition-all duration-200 ${barColor}`}
            style={{ width: `${Math.max(loadPct > 0 ? 3 : 0, loadPct)}%` }}
          />
        </div>
      </div>

      {totals.warnings.length > 0 && (
        <div
          data-testid="telemetry-warnings"
          className="space-y-1 rounded-xl border border-amber-400/35 bg-amber-950/75 p-2 text-[11px] text-amber-100"
        >
          {totals.warnings.map((w, idx) => (
            <div key={idx} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
