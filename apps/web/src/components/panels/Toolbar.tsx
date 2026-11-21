'use client';

import React, { useRef } from 'react';
import {
  MousePointer,
  Spline,
  RotateCw,
  SprayCan,
  MapPin,
  Sun,
  Sunset,
  Moon,
  Undo2,
  Redo2,
  Trash2,
  Download,
  Upload,
  Check,
} from 'lucide-react';
import {
  BULB_PRESET_SPECS,
  type BulbPreset,
  type LightPattern,
  type SurfaceMaterial,
  type ToolMode,
} from '@lumen3d/shared-schemas';
import { useStudioStore, type LightingMode } from '@/store/useStudioStore';

const COLOR_PRESET_SWATCHES: Array<{ label: string; colors: string[] }> = [
  { label: 'Warm White', colors: ['#ffd996'] },
  { label: 'Pure White', colors: ['#f8fbff'] },
  { label: 'Candy Cane', colors: ['#ff1e27', '#ffffff'] },
  { label: 'Classic Multi', colors: ['#ff2424', '#22c55e', '#3b82f6', '#f59e0b'] },
  { label: 'Nordic Ice', colors: ['#e0f4ff', '#60b8ff'] },
  { label: 'Holly & Gold', colors: ['#16a34a', '#ffd996', '#dc2626'] },
];

const SURFACE_MATERIALS: SurfaceMaterial[] = [
  'metal_gutter',
  'asphalt_shingle',
  'wood_fascia',
  'brick_masonry',
  'vinyl_siding',
  'stucco',
  'column_post',
  'balcony_railing',
  'balcony_soffit',
  'foliage_shrub',
  'ground_turf',
  'unknown',
];

export function Toolbar() {
  const fileImportRef = useRef<HTMLInputElement>(null);

  const toolMode = useStudioStore((s) => s.toolMode);
  const lightingMode = useStudioStore((s) => s.lightingMode);
  const activeBulbPreset = useStudioStore((s) => s.activeBulbPreset);
  const activeSpacingInches = useStudioStore((s) => s.activeSpacingInches);
  const activeColorsHex = useStudioStore((s) => s.activeColorsHex);
  const activePattern = useStudioStore((s) => s.activePattern);
  const activeHelixTurns = useStudioStore((s) => s.activeHelixTurns);
  const activeHelixRadius = useStudioStore((s) => s.activeHelixRadius);
  const activeBrushRadius = useStudioStore((s) => s.activeBrushRadius);
  const draftPoints = useStudioStore((s) => s.draftPoints);
  const runs = useStudioStore((s) => s.runs);
  const selectedRunId = useStudioStore((s) => s.selectedRunId);
  const pastRuns = useStudioStore((s) => s.pastRuns);
  const futureRuns = useStudioStore((s) => s.futureRuns);

  const setToolMode = useStudioStore((s) => s.setToolMode);
  const setLightingMode = useStudioStore((s) => s.setLightingMode);
  const setActiveBulbPreset = useStudioStore((s) => s.setActiveBulbPreset);
  const setActiveSpacingInches = useStudioStore((s) => s.setActiveSpacingInches);
  const setActiveColorsHex = useStudioStore((s) => s.setActiveColorsHex);
  const setActivePattern = useStudioStore((s) => s.setActivePattern);
  const setActiveHelixTurns = useStudioStore((s) => s.setActiveHelixTurns);
  const setActiveHelixRadius = useStudioStore((s) => s.setActiveHelixRadius);
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

  const toolButtons: Array<{ mode: ToolMode; label: string; icon: React.ReactNode }> = [
    { mode: 'SELECT', label: 'Select', icon: <MousePointer className="h-3.5 w-3.5" /> },
    { mode: 'LINEAR_EAVE', label: 'Linear / Eave', icon: <Spline className="h-3.5 w-3.5" /> },
    { mode: 'HELICAL_WRAP', label: 'Helix Wrap', icon: <RotateCw className="h-3.5 w-3.5" /> },
    { mode: 'SURFACE_SCATTER', label: 'Foliage Brush', icon: <SprayCan className="h-3.5 w-3.5" /> },
    { mode: 'PATHWAY_STAKE', label: 'Pathway Stakes', icon: <MapPin className="h-3.5 w-3.5" /> },
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

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      importProjectJson(text);
    } catch (err) {
      console.error('Invalid project JSON:', err);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <aside
      data-testid="studio-toolbar"
      className="flex h-full w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-studio-border bg-studio-panel p-3.5 text-xs text-slate-200"
    >
      {/* Lighting Mode Selector (Day / Dusk / Night) */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Environment Sky
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="btn-undo"
              disabled={pastRuns.length === 0}
              onClick={undo}
              title="Undo (Ctrl+Z)"
              className="rounded p-1 text-slate-300 hover:bg-slate-800 disabled:opacity-35"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="btn-redo"
              disabled={futureRuns.length === 0}
              onClick={redo}
              title="Redo (Ctrl+Y)"
              className="rounded p-1 text-slate-300 hover:bg-slate-800 disabled:opacity-35"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              { id: 'DAY', label: 'Day', icon: <Sun className="h-3.5 w-3.5" /> },
              { id: 'DUSK', label: 'Dusk', icon: <Sunset className="h-3.5 w-3.5" /> },
              { id: 'NIGHT', label: 'Night', icon: <Moon className="h-3.5 w-3.5" /> },
            ] as Array<{ id: LightingMode; label: string; icon: React.ReactNode }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`btn-lighting-${item.id.toLowerCase()}`}
              onClick={() => setLightingMode(item.id)}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition ${
                lightingMode === item.id
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Parametric Light Placement Tools */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          3D Light Placement Tools
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {toolButtons.map((btn) => (
            <button
              key={btn.mode}
              type="button"
              data-testid={`tool-${btn.mode.toLowerCase()}`}
              onClick={() => setToolMode(btn.mode)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-left font-medium transition ${
                toolMode === btn.mode
                  ? 'bg-sky-500 text-slate-950 shadow'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {btn.icon}
              <span className="truncate">{btn.label}</span>
            </button>
          ))}
        </div>

        {draftPoints.length > 0 && (
          <div className="mt-2 flex items-center justify-between rounded-lg bg-sky-950/80 px-2.5 py-1.5 ring-1 ring-sky-500/40">
            <span className="text-[11px] text-sky-200">
              Draft pts: <strong>{draftPoints.length}</strong>
            </span>
            <div className="flex gap-1.5">
              {draftPoints.length >= 2 && (
                <button
                  type="button"
                  data-testid="btn-finish-run"
                  onClick={() => commitDraftRun()}
                  className="inline-flex items-center gap-1 rounded bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  <Check className="h-3 w-3" /> Finish
                </button>
              )}
              <button
                type="button"
                onClick={cancelDraft}
                className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bulb Type, Spacing & Parametric Sliders */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Bulb &amp; Strand Parameters
        </div>

        <label className="mb-2 block">
          <span className="mb-1 block text-[11px] text-slate-400">Bulb Preset</span>
          <select
            data-testid="select-bulb-preset"
            value={selectedRun ? selectedRun.bulbPreset : activeBulbPreset}
            onChange={(e) => {
              const next = e.target.value as BulbPreset;
              if (selectedRun) {
                updateRun(selectedRun.id, {
                  bulbPreset: next,
                  spacingInches: BULB_PRESET_SPECS[next].defaultSpacingInches,
                });
              } else {
                setActiveBulbPreset(next);
              }
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100"
          >
            {Object.values(BULB_PRESET_SPECS).map((spec) => (
              <option key={spec.id} value={spec.id}>
                {spec.label} ({spec.wattsPerBulb}W)
              </option>
            ))}
          </select>
        </label>

        <label className="mb-2 block">
          <div className="mb-1 flex justify-between text-[11px]">
            <span className="text-slate-400">Bulb Spacing</span>
            <span className="font-semibold text-amber-300">
              {selectedRun ? selectedRun.spacingInches : activeSpacingInches}&quot;
            </span>
          </div>
          <input
            type="range"
            min={2}
            max={36}
            step={1}
            data-testid="slider-spacing"
            value={selectedRun ? selectedRun.spacingInches : activeSpacingInches}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (selectedRun) {
                updateRun(selectedRun.id, { spacingInches: val });
              } else {
                setActiveSpacingInches(val);
              }
            }}
            className="w-full accent-amber-400"
          />
        </label>

        {(toolMode === 'HELICAL_WRAP' || selectedRun?.toolMode === 'HELICAL_WRAP') && (
          <div className="mt-2 space-y-2 border-t border-slate-800 pt-2">
            <label className="block">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Helix Turns</span>
                <span className="font-semibold text-sky-300">
                  {selectedRun?.helixParams ? selectedRun.helixParams.turns : activeHelixTurns}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={16}
                step={0.5}
                value={
                  selectedRun?.helixParams ? selectedRun.helixParams.turns : activeHelixTurns
                }
                onChange={(e) => {
                  const turns = Number(e.target.value);
                  if (selectedRun?.helixParams) {
                    updateRun(selectedRun.id, {
                      helixParams: { ...selectedRun.helixParams, turns },
                    });
                  } else {
                    setActiveHelixTurns(turns);
                  }
                }}
                className="w-full accent-sky-400"
              />
            </label>

            <label className="block">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Column Radius (units)</span>
                <span className="font-semibold text-sky-300">
                  {(selectedRun?.helixParams
                    ? selectedRun.helixParams.radius
                    : activeHelixRadius
                  ).toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.06}
                max={0.8}
                step={0.01}
                value={
                  selectedRun?.helixParams ? selectedRun.helixParams.radius : activeHelixRadius
                }
                onChange={(e) => {
                  const radius = Number(e.target.value);
                  if (selectedRun?.helixParams) {
                    updateRun(selectedRun.id, {
                      helixParams: { ...selectedRun.helixParams, radius },
                    });
                  } else {
                    setActiveHelixRadius(radius);
                  }
                }}
                className="w-full accent-sky-400"
              />
            </label>
          </div>
        )}

        {toolMode === 'SURFACE_SCATTER' && (
          <label className="mt-2 block border-t border-slate-800 pt-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Brush Radius</span>
              <span className="font-semibold text-emerald-300">
                {activeBrushRadius.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.15}
              max={1.5}
              step={0.05}
              value={activeBrushRadius}
              onChange={(e) => setActiveBrushRadius(Number(e.target.value))}
              className="w-full accent-emerald-400"
            />
          </label>
        )}
      </div>

      {/* Color Swatches & Pattern */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Color Palette &amp; Pattern
        </div>

        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {COLOR_PRESET_SWATCHES.map((swatch) => (
            <button
              key={swatch.label}
              type="button"
              onClick={() => {
                if (selectedRun) {
                  updateRun(selectedRun.id, { colorsHex: swatch.colors });
                } else {
                  setActiveColorsHex(swatch.colors);
                }
              }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-left hover:border-slate-600"
            >
              <span className="flex -space-x-1">
                {swatch.colors.slice(0, 3).map((hex, i) => (
                  <span
                    key={i}
                    className="inline-block h-3 w-3 rounded-full ring-1 ring-slate-950"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </span>
              <span className="truncate text-[11px] text-slate-200">{swatch.label}</span>
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] text-slate-400">Pattern</span>
          <select
            data-testid="select-pattern"
            value={selectedRun ? selectedRun.pattern : activePattern}
            onChange={(e) => {
              const pat = e.target.value as LightPattern;
              if (selectedRun) {
                updateRun(selectedRun.id, { pattern: pat });
              } else {
                setActivePattern(pat);
              }
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100"
          >
            <option value="SOLID">Solid</option>
            <option value="ALTERNATING">Alternating</option>
            <option value="CANDY_CANE">Candy Cane (3x3)</option>
            <option value="TWINKLE">Animated Twinkle</option>
          </select>
        </label>
      </div>

      {/* Active Runs List & Selected Run Inspector */}
      <div className="flex-1 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Installed Runs ({runs.length})
          </span>
          {selectedRun && (
            <button
              type="button"
              data-testid="btn-delete-selected-run"
              onClick={() => deleteRun(selectedRun.id)}
              className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/30"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          )}
        </div>

        {runs.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-slate-500">
            Click along eaves, columns, shrubs, or walkways in the 3D scene to place lights.
          </p>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() =>
                  selectRun(selectedRunId === run.id ? null : run.id)
                }
                className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition ${
                  selectedRunId === run.id
                    ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/50'
                    : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="truncate font-medium">{run.name}</span>
                <span className="ml-2 shrink-0 text-[10px] text-slate-400">
                  {run.bulbPositions.length} bulbs
                </span>
              </button>
            ))}
          </div>
        )}

        {selectedRun && (
          <label className="mt-2 block border-t border-slate-800 pt-2">
            <span className="mb-1 block text-[11px] text-slate-400">
              Mounting Surface Material
            </span>
            <select
              value={selectedRun.surfaceMaterial}
              onChange={(e) =>
                updateRun(selectedRun.id, {
                  surfaceMaterial: e.target.value as SurfaceMaterial,
                })
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200"
            >
              {SURFACE_MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Project JSON Save / Load */}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          data-testid="btn-export-json"
          onClick={handleDownloadJson}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 py-1.5 font-medium text-slate-200 hover:bg-slate-800"
        >
          <Download className="h-3.5 w-3.5" /> Save JSON
        </button>
        <button
          type="button"
          data-testid="btn-import-json"
          onClick={() => fileImportRef.current?.click()}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 py-1.5 font-medium text-slate-200 hover:bg-slate-800"
        >
          <Upload className="h-3.5 w-3.5" /> Load JSON
        </button>
        <input
          ref={fileImportRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportFile}
          className="hidden"
        />
      </div>
    </aside>
  );
}
