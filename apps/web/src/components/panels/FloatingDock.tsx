'use client';

import React, { useRef, useState } from 'react';
import {
  MousePointer,
  Spline,
  RotateCw,
  SprayCan,
  Footprints,
  SlidersHorizontal,
  Undo2,
  Redo2,
  Check,
  Trash2,
  Download,
  Upload,
  X,
} from 'lucide-react';
import {
  BULB_PRESET_SPECS,
  type BulbPreset,
  type LightPattern,
  type SurfaceMaterial,
  type ToolMode,
} from '@lumen3d/shared-schemas';
import { useStudioStore } from '@/store/useStudioStore';

const COLOR_PRESET_SWATCHES: Array<{ label: string; colors: string[] }> = [
  { label: 'Warm White', colors: ['#ffd996'] },
  { label: 'Pure White', colors: ['#f8fbff'] },
  { label: 'Candy Cane', colors: ['#ff1e27', '#ffffff'] },
  { label: 'Classic Multi', colors: ['#ff2424', '#22c55e', '#3b82f6', '#f59e0b'] },
  { label: 'Nordic Ice', colors: ['#e0f4ff', '#60b8ff'] },
  { label: 'Holly & Gold', colors: ['#16a34a', '#ffd996', '#dc2626'] },
];

const SURFACE_OPTIONS: Array<{ value: SurfaceMaterial; label: string }> = [
  { value: 'balcony_railing', label: 'Balcony Railing (No Drill, 0ft Ladder)' },
  { value: 'balcony_soffit', label: 'Balcony Ceiling Soffit (6ft Step-Stool)' },
  { value: 'metal_gutter', label: 'Eave / Metal Gutter' },
  { value: 'asphalt_shingle', label: 'Roof Shingle Edge' },
  { value: 'brick_masonry', label: 'Brick / Masonry Facade' },
  { value: 'stucco', label: 'Stucco / Concrete Wall' },
  { value: 'wood_fascia', label: 'Wood Fascia / Trim' },
  { value: 'vinyl_siding', label: 'Vinyl Siding' },
  { value: 'column_post', label: 'Porch Column / Post' },
  { value: 'foliage_shrub', label: 'Shrub / Bush Canopy' },
  { value: 'ground_turf', label: 'Walkway / Ground Turf' },
];

const BULB_SHORT_NAMES: Record<BulbPreset, string> = {
  C9_LED: 'C9',
  C7_LED: 'C7',
  MINI_5MM_LED: '5mm Mini',
  ICICLE_DROP_LED: 'Icicle',
  RGB_SOFFIT_PUCK: 'RGB Puck',
  PATHWAY_C9_STAKE: 'Stake C9',
};

export function FloatingDock() {
  const fileImportRef = useRef<HTMLInputElement>(null);
  const [isStyleOpen, setIsStyleOpen] = useState(false);

  const toolMode = useStudioStore((s) => s.toolMode);
  const activeBulbPreset = useStudioStore((s) => s.activeBulbPreset);
  const activeSpacingInches = useStudioStore((s) => s.activeSpacingInches);
  const activeColorsHex = useStudioStore((s) => s.activeColorsHex);
  const activePattern = useStudioStore((s) => s.activePattern);
  const activeHelixTurns = useStudioStore((s) => s.activeHelixTurns);
  const activeBrushRadius = useStudioStore((s) => s.activeBrushRadius);
  const draftPoints = useStudioStore((s) => s.draftPoints);
  const runs = useStudioStore((s) => s.runs);
  const selectedRunId = useStudioStore((s) => s.selectedRunId);
  const pastRuns = useStudioStore((s) => s.pastRuns);
  const futureRuns = useStudioStore((s) => s.futureRuns);

  const setToolMode = useStudioStore((s) => s.setToolMode);
  const setActiveBulbPreset = useStudioStore((s) => s.setActiveBulbPreset);
  const setActiveSpacingInches = useStudioStore((s) => s.setActiveSpacingInches);
  const setActiveColorsHex = useStudioStore((s) => s.setActiveColorsHex);
  const setActivePattern = useStudioStore((s) => s.setActivePattern);
  const setActiveHelixTurns = useStudioStore((s) => s.setActiveHelixTurns);
  const setActiveBrushRadius = useStudioStore((s) => s.setActiveBrushRadius);
  const commitDraftRun = useStudioStore((s) => s.commitDraftRun);
  const cancelDraft = useStudioStore((s) => s.cancelDraft);
  const selectRun = useStudioStore((s) => s.selectRun);
  const updateRun = useStudioStore((s) => s.updateRun);
  const deleteRun = useStudioStore((s) => s.deleteRun);
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const exportProjectJson = useStudioStore((s) => s.exportProjectJson);
  const importProjectJson = useStudioStore((s) => s.importProjectJson);

  const selectedRun = runs.find((r) => r.id === selectedRunId) || null;

  const tools: Array<{
    mode: ToolMode;
    shortcut: string;
    label: string;
    testId: string;
    icon: React.ReactNode;
  }> = [
    {
      mode: 'SELECT',
      shortcut: '1',
      label: 'Select',
      testId: 'tool-select',
      icon: <MousePointer className="h-3.5 w-3.5" />,
    },
    {
      mode: 'LINEAR_EAVE',
      shortcut: '2',
      label: 'Roof & Railings',
      testId: 'tool-linear_eave',
      icon: <Spline className="h-3.5 w-3.5" />,
    },
    {
      mode: 'HELICAL_WRAP',
      shortcut: '3',
      label: 'Wrap Column',
      testId: 'tool-helical_wrap',
      icon: <RotateCw className="h-3.5 w-3.5" />,
    },
    {
      mode: 'SURFACE_SCATTER',
      shortcut: '4',
      label: 'Bushes',
      testId: 'tool-surface_scatter',
      icon: <SprayCan className="h-3.5 w-3.5" />,
    },
    {
      mode: 'PATHWAY_STAKE',
      shortcut: '5',
      label: 'Walkway',
      testId: 'tool-pathway_stake',
      icon: <Footprints className="h-3.5 w-3.5" />,
    },
  ];

  const handleDownloadJson = () => {
    const json = exportProjectJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lumen3d-project.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-testid="floating-dock"
      className="pointer-events-none fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2.5"
    >
      {/* Upward Style, Bulb & Installed Strands Popover */}
      {isStyleOpen && (
        <div
          data-testid="style-popover"
          style={{ backgroundColor: 'rgba(5, 8, 20, 0.96)' }}
          className="pointer-events-auto w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/15 p-4 text-xs text-slate-200 shadow-[0_24px_60px_rgba(0,0,0,0.75)] backdrop-blur-2xl"
        >
          <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2">
            <span className="font-semibold text-white">
              Bulb Style, Colors &amp; Strands ({runs.length})
            </span>
            <button
              type="button"
              onClick={() => setIsStyleOpen(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="mb-1 block text-[11px] text-slate-400">Bulb Type</span>
              <select
                data-testid="select-bulb-preset"
                value={selectedRun ? selectedRun.bulbPreset : activeBulbPreset}
                onChange={(e) => {
                  const p = e.target.value as BulbPreset;
                  setActiveBulbPreset(p);
                  if (selectedRun) {
                    updateRun(selectedRun.id, {
                      bulbPreset: p,
                      spacingInches: BULB_PRESET_SPECS[p].defaultSpacingInches,
                    });
                  }
                }}
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-slate-100"
              >
                {(Object.keys(BULB_PRESET_SPECS) as BulbPreset[]).map((key) => (
                  <option key={key} value={key}>
                    {BULB_PRESET_SPECS[key].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-slate-400">Pattern</span>
              <select
                data-testid="select-light-pattern"
                value={selectedRun ? selectedRun.pattern : activePattern}
                onChange={(e) => {
                  const pat = e.target.value as LightPattern;
                  setActivePattern(pat);
                  if (selectedRun) updateRun(selectedRun.id, { pattern: pat });
                }}
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-slate-100"
              >
                <option value="SOLID">Solid</option>
                <option value="ALTERNATING">Alternating</option>
                <option value="CANDY_CANE">Candy Cane</option>
                <option value="TWINKLE">Twinkle</option>
              </select>
            </label>
          </div>

          <label className="mt-2.5 block">
            <div className="mb-1 flex justify-between text-[11px]">
              <span className="text-slate-400">Bulb Spacing</span>
              <span className="font-semibold text-amber-300">
                {selectedRun ? selectedRun.spacingInches : activeSpacingInches}&quot;
              </span>
            </div>
            <input
              type="range"
              min={3}
              max={30}
              step={1}
              data-testid="slider-spacing"
              value={selectedRun ? selectedRun.spacingInches : activeSpacingInches}
              onChange={(e) => {
                const v = Number(e.target.value);
                setActiveSpacingInches(v);
                if (selectedRun) updateRun(selectedRun.id, { spacingInches: v });
              }}
              className="w-full accent-amber-400"
            />
          </label>

          {toolMode === 'HELICAL_WRAP' && (
            <label className="mt-2 block">
              <div className="mb-0.5 flex justify-between text-[11px]">
                <span className="text-slate-400">Column Helix Turns</span>
                <span className="text-amber-300">{activeHelixTurns} turns</span>
              </div>
              <input
                type="range"
                min={2}
                max={14}
                step={0.5}
                value={activeHelixTurns}
                onChange={(e) => setActiveHelixTurns(Number(e.target.value))}
                className="w-full accent-amber-400"
              />
            </label>
          )}

          {toolMode === 'SURFACE_SCATTER' && (
            <label className="mt-2 block">
              <div className="mb-0.5 flex justify-between text-[11px]">
                <span className="text-slate-400">Bush Brush Radius</span>
                <span className="text-amber-300">{activeBrushRadius.toFixed(2)}m</span>
              </div>
              <input
                type="range"
                min={0.2}
                max={1.6}
                step={0.05}
                value={activeBrushRadius}
                onChange={(e) => setActiveBrushRadius(Number(e.target.value))}
                className="w-full accent-amber-400"
              />
            </label>
          )}

          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {COLOR_PRESET_SWATCHES.map((swatch) => (
              <button
                key={swatch.label}
                type="button"
                onClick={() => {
                  setActiveColorsHex(swatch.colors);
                  if (selectedRun) {
                    updateRun(selectedRun.id, { colorsHex: swatch.colors });
                  }
                }}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-left text-[11px] hover:bg-white/[0.1]"
              >
                <span className="flex shrink-0 -space-x-1">
                  {swatch.colors.slice(0, 3).map((hex, i) => (
                    <span
                      key={i}
                      className="h-2.5 w-2.5 rounded-full ring-1 ring-slate-950"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </span>
                <span className="truncate text-slate-200">{swatch.label}</span>
              </button>
            ))}
          </div>

          {/* Installed Strands & Surface Material Override (critical for 3D Tiles Balcony tagging!) */}
          {runs.length > 0 && (
            <div className="mt-3 border-t border-white/10 pt-2.5">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Installed Strands
              </div>
              <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
                {runs.map((run) => {
                  const isSel = run.id === selectedRunId;
                  return (
                    <div
                      key={run.id}
                      onClick={() => selectRun(isSel ? null : run.id)}
                      className={`flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 ${
                        isSel
                          ? 'bg-amber-400/15 ring-1 ring-amber-400/50'
                          : 'bg-white/[0.03] hover:bg-white/[0.07]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-100">
                          {run.name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {run.bulbPositions.length} bulbs · {run.surfaceMaterial}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRun(run.id);
                        }}
                        className="ml-2 rounded p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                        aria-label={`Delete ${run.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {selectedRun && (
                <label className="mt-2 block">
                  <span className="mb-1 block text-[10px] text-slate-400">
                    Mounting Surface (for Clips &amp; Ladder Math)
                  </span>
                  <select
                    value={selectedRun.surfaceMaterial}
                    onChange={(e) =>
                      updateRun(selectedRun.id, {
                        surfaceMaterial: e.target.value as SurfaceMaterial,
                      })
                    }
                    className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
                  >
                    {SURFACE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {/* Save / Load JSON */}
          <div className="mt-3 flex gap-2 border-t border-white/10 pt-2.5">
            <button
              type="button"
              data-testid="btn-export-json"
              onClick={handleDownloadJson}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] py-1.5 text-[11px] text-slate-200 hover:bg-white/[0.08]"
            >
              <Download className="h-3 w-3" /> Save Project
            </button>
            <button
              type="button"
              data-testid="btn-import-json"
              onClick={() => fileImportRef.current?.click()}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] py-1.5 text-[11px] text-slate-200 hover:bg-white/[0.08]"
            >
              <Upload className="h-3 w-3" /> Load Project
            </button>
            <input
              ref={fileImportRef}
              type="file"
              accept="application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  importProjectJson(await file.text());
                } catch {
                  // ignore malformed JSON
                } finally {
                  e.target.value = '';
                }
              }}
              className="hidden"
            />
          </div>
        </div>
      )}

      {/* Contextual Active Drawing Pill */}
      {draftPoints.length > 0 && (
        <div
          style={{ backgroundColor: 'rgba(5, 8, 20, 0.95)' }}
          className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-amber-400/40 px-4 py-1.5 text-xs text-slate-100 shadow-xl backdrop-blur-xl"
        >
          <span className="text-slate-300">
            <strong className="text-amber-300">{draftPoints.length}</strong>{' '}
            {draftPoints.length === 1 ? 'point' : 'points'} placed
          </span>
          {draftPoints.length >= 2 && (
            <button
              type="button"
              data-testid="btn-finish-run"
              onClick={() => commitDraftRun()}
              className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-300"
            >
              <Check className="h-3 w-3" /> Finish Strand
            </button>
          )}
          <button
            type="button"
            onClick={cancelDraft}
            className="rounded-full px-2 py-0.5 text-[11px] text-slate-400 hover:bg-white/10 hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Main Horizontal Floating Dock */}
      <div
        style={{ backgroundColor: 'rgba(5, 8, 20, 0.94)' }}
        className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/15 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.75)] backdrop-blur-2xl"
      >
        {tools.map((t) => {
          const active = toolMode === t.mode;
          return (
            <button
              key={t.mode}
              type="button"
              data-testid={t.testId}
              onClick={() => setToolMode(t.mode)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2 text-xs font-medium transition ${
                active
                  ? 'bg-amber-400 font-semibold text-slate-950 shadow-sm'
                  : 'text-slate-200 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}

        <div className="mx-0.5 h-5 w-px bg-white/15" />

        {/* Bulb & Color Style Popover Trigger */}
        <button
          type="button"
          data-testid="btn-toggle-style-popover"
          onClick={() => setIsStyleOpen((v) => !v)}
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2 text-xs font-medium transition ${
            isStyleOpen
              ? 'bg-white/15 text-white'
              : 'text-slate-200 hover:bg-white/[0.08]'
          }`}
        >
          <span className="flex -space-x-1">
            {activeColorsHex.slice(0, 3).map((hex, idx) => (
              <span
                key={idx}
                className="h-3 w-3 rounded-full ring-1 ring-slate-950"
                style={{ backgroundColor: hex }}
              />
            ))}
          </span>
          <span className="hidden md:inline">
            {BULB_SHORT_NAMES[activeBulbPreset]} · {activeSpacingInches}&quot;
          </span>
          <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
        </button>

        <div className="mx-1 h-5 w-px bg-white/12" />

        <button
          type="button"
          data-testid="btn-undo"
          disabled={pastRuns.length === 0}
          onClick={undo}
          title="Undo (Cmd/Ctrl+Z)"
          className="rounded-xl p-2 text-slate-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          data-testid="btn-redo"
          disabled={futureRuns.length === 0}
          onClick={redo}
          title="Redo (Cmd+Shift+Z)"
          className="rounded-xl p-2 text-slate-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
