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
  const capacityWatts = totals.gfci15ACircuitsNeeded * NEC_15A_CONTINUOUS_WATTS_LIMIT;
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
      className="pointer-events-auto flex flex-col gap-2.5 rounded-xl border border-slate-700/80 bg-slate-950/88 px-3.5 py-3 text-xs text-slate-200 shadow-xl backdrop-blur-md"
    >
      <div className="grid grid-cols-4 gap-3">
        <div>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
            <Ruler className="h-3 w-3 text-sky-400" />
            Footage
          </div>
          <div
            data-testid="telemetry-total-feet"
            className="mt-0.5 text-sm font-bold tabular-nums text-slate-100"
          >
            {totals.totalLengthFeet.toFixed(1)} ft
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
            <Lightbulb className="h-3 w-3 text-amber-400" />
            Bulbs
          </div>
          <div
            data-testid="telemetry-total-bulbs"
            className="mt-0.5 text-sm font-bold tabular-nums text-slate-100"
          >
            {totals.totalBulbs}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
            <Zap className="h-3 w-3 text-emerald-400" />
            Power (120V)
          </div>
          <div
            data-testid="telemetry-total-watts"
            className="mt-0.5 text-sm font-bold tabular-nums text-slate-100"
          >
            {totals.totalWatts.toFixed(1)}W{' '}
            <span className="text-[11px] font-normal text-slate-400">
              ({totals.totalAmps120V.toFixed(2)}A)
            </span>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
            <ArrowUpFromLine className="h-3 w-3 text-purple-400" />
            Max / Ladder
          </div>
          <div
            data-testid="telemetry-ladder"
            className="mt-0.5 text-sm font-bold tabular-nums text-slate-100"
          >
            {totals.maxHeightFeet.toFixed(1)}ft /{' '}
            {totals.recommendedLadderFeet > 0
              ? `${totals.recommendedLadderFeet}ft`
              : '—'}
          </div>
        </div>
      </div>

      {/* NEC 15A / 80% (1,440W) Continuous Circuit Load Bar */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="text-slate-400">
            NEC 15A GFCI Load (80% = 1,440W/circuit)
          </span>
          <span
            data-testid="telemetry-circuits"
            className="font-semibold text-emerald-300"
          >
            {totals.gfci15ACircuitsNeeded} GFCI{' '}
            {totals.gfci15ACircuitsNeeded === 1 ? 'Circuit' : 'Circuits'} (
            {loadPct.toFixed(1)}%)
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full transition-all duration-200 ${barColor}`}
            style={{ width: `${Math.max(loadPct > 0 ? 3 : 0, loadPct)}%` }}
          />
        </div>
      </div>

      {totals.warnings.length > 0 && (
        <div
          data-testid="telemetry-warnings"
          className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-950/60 p-2 text-[11px] text-amber-200"
        >
          {totals.warnings.map((w, idx) => (
            <div key={idx} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
