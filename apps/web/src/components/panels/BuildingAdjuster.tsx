'use client';

import React, { useEffect, useState } from 'react';
import { Building2, Plus, Trash2, RefreshCw } from 'lucide-react';
import type {
  ArchitecturalBuildingSpec,
  BalconyMountStyle,
  BalconyRailingType,
  BalconySpec,
  BalconyWallFace,
} from '@lumen3d/shared-schemas';

export interface BuildingAdjusterProps {
  spec: ArchitecturalBuildingSpec;
  isReconstructing: boolean;
  onRebuildSpec: (updatedSpec: ArchitecturalBuildingSpec) => void;
}

export function BuildingAdjuster({
  spec,
  isReconstructing,
  onRebuildSpec,
}: BuildingAdjusterProps) {
  const [draft, setDraft] = useState<ArchitecturalBuildingSpec>(spec);

  useEffect(() => {
    setDraft(spec);
  }, [spec]);

  const updateBalcony = (index: number, patch: Partial<BalconySpec>) => {
    setDraft((prev) => ({
      ...prev,
      balconies: prev.balconies.map((b, i) =>
        i === index ? { ...b, ...patch } : b
      ),
    }));
  };

  const addBalcony = () => {
    const nextFloor = Math.min(draft.floors, Math.max(2, draft.balconies.length + 2));
    const newBal: BalconySpec = {
      id: `balcony-${Date.now().toString(36).slice(-4)}`,
      floor: nextFloor > draft.floors ? draft.floors : nextFloor,
      wallFace: 'front',
      centerOffsetNorm: draft.balconies.length % 2 === 0 ? -0.2 : 0.2,
      widthMeters: 3.4,
      depthMeters: 1.4,
      mountStyle: 'cantilevered',
      railingType: 'metal_picket',
    };
    setDraft((prev) => ({
      ...prev,
      balconies: [...prev.balconies, newBal],
    }));
  };

  const removeBalcony = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      balconies: prev.balconies.filter((_, i) => i !== index),
    }));
  };

  return (
    <div
      data-testid="building-adjuster-panel"
      className="rounded-xl border border-amber-500/30 bg-slate-950/80 p-2.5 text-xs"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
          <Building2 className="h-3.5 w-3.5" />
          3D Building &amp; Balconies
        </span>
        <button
          type="button"
          data-testid="btn-add-balcony"
          onClick={addBalcony}
          className="inline-flex items-center gap-0.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-slate-700"
        >
          <Plus className="h-3 w-3" /> Balcony
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-slate-400">
            Stories ({draft.floors})
          </span>
          <input
            type="range"
            min={1}
            max={6}
            step={1}
            data-testid="slider-building-floors"
            value={draft.floors}
            onChange={(e) => {
              const floors = Number(e.target.value);
              setDraft((prev) => ({
                ...prev,
                floors,
                balconies: prev.balconies.map((b) => ({
                  ...b,
                  floor: Math.min(floors, b.floor),
                })),
              }));
            }}
            className="w-full accent-amber-400"
          />
        </label>

        <label className="block">
          <span className="mb-0.5 block text-[10px] text-slate-400">Roof</span>
          <select
            data-testid="select-roof-style"
            value={draft.roofStyle}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                roofStyle: e.target.value as ArchitecturalBuildingSpec['roofStyle'],
              }))
            }
            className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-100"
          >
            <option value="flat_parapet">Flat Parapet</option>
            <option value="pitched_gable">Pitched Gable</option>
            <option value="hip">Hip Roof</option>
          </select>
        </label>
      </div>

      {draft.balconies.length > 0 && (
        <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-0.5">
          {draft.balconies.map((bal, idx) => (
            <div
              key={bal.id}
              className="rounded-lg border border-slate-800 bg-slate-900/90 p-1.5 text-[10px]"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-slate-200">
                  Balcony #{idx + 1} (Floor {bal.floor})
                </span>
                <button
                  type="button"
                  onClick={() => removeBalcony(idx)}
                  className="text-rose-400 hover:text-rose-300"
                  aria-label="Remove balcony"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <select
                  aria-label={`Balcony ${idx + 1} floor`}
                  value={bal.floor}
                  onChange={(e) =>
                    updateBalcony(idx, { floor: Number(e.target.value) })
                  }
                  className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-slate-200"
                >
                  {Array.from({ length: draft.floors }, (_, i) => i + 1).map(
                    (fl) => (
                      <option key={fl} value={fl}>
                        {fl}F
                      </option>
                    )
                  )}
                </select>

                <select
                  aria-label={`Balcony ${idx + 1} face`}
                  value={bal.wallFace}
                  onChange={(e) =>
                    updateBalcony(idx, {
                      wallFace: e.target.value as BalconyWallFace,
                    })
                  }
                  className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-slate-200"
                >
                  <option value="front">Front</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="rear">Rear</option>
                </select>

                <select
                  aria-label={`Balcony ${idx + 1} railing`}
                  data-testid={`select-balcony-railing-${idx}`}
                  value={bal.railingType}
                  onChange={(e) =>
                    updateBalcony(idx, {
                      railingType: e.target.value as BalconyRailingType,
                    })
                  }
                  className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-slate-200"
                >
                  <option value="metal_picket">Picket</option>
                  <option value="glass_panel">Glass</option>
                  <option value="solid_parapet">Parapet</option>
                </select>
              </div>
              <div className="mt-1 flex items-center justify-between gap-1">
                <select
                  aria-label={`Balcony ${idx + 1} mount`}
                  value={bal.mountStyle}
                  onChange={(e) =>
                    updateBalcony(idx, {
                      mountStyle: e.target.value as BalconyMountStyle,
                    })
                  }
                  className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-slate-300"
                >
                  <option value="cantilevered">Cantilevered</option>
                  <option value="recessed">Recessed</option>
                </select>
                <span className="text-slate-400">
                  Pos: {(bal.centerOffsetNorm * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        data-testid="btn-rebuild-spec"
        disabled={isReconstructing}
        onClick={() => onRebuildSpec(draft)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500/20 py-1.5 font-semibold text-amber-300 ring-1 ring-amber-400/40 hover:bg-amber-500/30 disabled:opacity-50"
      >
        <RefreshCw className="h-3 w-3" />
        Rebuild 3D Mesh
      </button>
    </div>
  );
}
