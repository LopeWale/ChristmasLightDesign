'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  ShoppingBag,
  FileSpreadsheet,
  FileText,
  Loader2,
  Eye,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  BOMReportSchema,
  CritiqueReportSchema,
  type BOMReport,
  type CritiqueReport,
  type DesignTelemetry,
} from '@lumen3d/shared-schemas';
import { formatBOMAsCsv, formatBOMAsMarkdown } from '@/lib/bomExport';
import { useStudioStore } from '@/store/useStudioStore';

export interface CopilotDrawerProps {
  telemetry: DesignTelemetry;
  captureNightScreenshot: () => string | null;
}

const QUICK_STYLE_CHIPS = [
  'Warm classic architectural',
  'High-energy candy cane',
  'Nordic icicle frost',
];

export function CopilotDrawer({
  telemetry,
  captureNightScreenshot,
}: CopilotDrawerProps) {
  const activeDrawer = useStudioStore((s) => s.activeDrawer);
  const setActiveDrawer = useStudioStore((s) => s.setActiveDrawer);
  const job = useStudioStore((s) => s.job);
  const runs = useStudioStore((s) => s.runs);
  const detectedZones = useStudioStore((s) => s.detectedZones);
  const applyConceptPreset = useStudioStore((s) => s.applyConceptPreset);

  const [stylePrompt, setStylePrompt] = useState<string>(
    'Warm classic architectural'
  );
  const [critique, setCritique] = useState<CritiqueReport | null>(null);
  const [bom, setBom] = useState<BOMReport | null>(null);
  const [isCritiquing, setIsCritiquing] = useState<boolean>(false);
  const [isGeneratingBom, setIsGeneratingBom] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (activeDrawer === 'NONE') return null;

  const handleRequestCritique = async () => {
    try {
      setIsCritiquing(true);
      setErrorMsg(null);
      const nightPng =
        captureNightScreenshot() ||
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const resp = await fetch('/api/copilot/critique', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job?.jobId,
          daylightImageUrl: job?.referenceImageUrl,
          nightSnapshotBase64: nightPng,
          telemetry,
          currentRuns: runs,
          stylePrompt,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Critique request failed');
      }
      setCritique(CritiqueReportSchema.parse(data));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to run Gemini critique'
      );
    } finally {
      setIsCritiquing(false);
    }
  };

  const handleGenerateBom = async () => {
    try {
      setIsGeneratingBom(true);
      setErrorMsg(null);

      const resp = await fetch('/api/copilot/bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telemetry,
          detectedZones,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'BOM request failed');
      }
      setBom(BOMReportSchema.parse(data));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to generate Hardware BOM'
      );
    } finally {
      setIsGeneratingBom(false);
    }
  };

  const downloadBlob = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <aside
      data-testid="copilot-drawer"
      style={{ backgroundColor: 'rgba(7, 11, 22, 0.96)' }}
      className="pointer-events-auto fixed bottom-5 right-4 top-16 z-30 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-2xl border border-white/15 p-4 text-xs text-slate-200 shadow-[0_28px_70px_rgba(0,0,0,0.82)] backdrop-blur-2xl"
    >
      {/* Slide-Over Header + Tabs + Close */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.04] p-0.5">
          <button
            type="button"
            onClick={() => setActiveDrawer('COPILOT')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeDrawer === 'COPILOT'
                ? 'bg-amber-400 font-semibold text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI Critique
          </button>
          <button
            type="button"
            onClick={() => setActiveDrawer('BOM')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeDrawer === 'BOM'
                ? 'bg-amber-400 font-semibold text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            Shopping List
          </button>
        </div>

        <button
          type="button"
          data-testid="btn-close-drawer"
          onClick={() => setActiveDrawer('NONE')}
          aria-label="Close drawer"
          className="rounded-xl p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {errorMsg && (
        <div
          data-testid="copilot-error"
          className="rounded-xl border border-rose-500/40 bg-rose-950/70 p-2.5 text-[11px] text-rose-200"
        >
          {errorMsg}
        </div>
      )}

      {activeDrawer === 'COPILOT' && (
        <section className="space-y-3">
          <div>
            <label
              htmlFor="copilot-style-input"
              className="mb-1 block text-[11px] font-medium text-slate-300"
            >
              Design Direction
            </label>
            <input
              id="copilot-style-input"
              type="text"
              data-testid="input-style-prompt"
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              placeholder="Warm classic architectural"
              className="w-full rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_STYLE_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setStylePrompt(chip)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/[0.1]"
              >
                {chip}
              </button>
            ))}
          </div>

          <button
            type="button"
            data-testid="btn-request-critique"
            disabled={isCritiquing}
            onClick={handleRequestCritique}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-400 py-2.5 text-xs font-semibold text-slate-950 shadow transition hover:bg-amber-300 disabled:opacity-50"
          >
            {isCritiquing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {isCritiquing ? 'Analyzing 3D Render…' : 'Critique Night Render'}
          </button>

          {critique && (
            <div data-testid="critique-results" className="space-y-3 pt-1">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <span className="text-[11px] font-medium text-slate-300">
                  Architectural Lighting Score
                </span>
                <span
                  data-testid="critique-score"
                  className="rounded-lg bg-emerald-500/20 px-2.5 py-0.5 text-sm font-bold text-emerald-300 ring-1 ring-emerald-400/40"
                >
                  {critique.overallScore.toFixed(1)} / 10
                </span>
              </div>

              <p className="text-xs leading-relaxed text-slate-300">
                {critique.architecturalCritique}
              </p>
              <p className="text-xs leading-relaxed text-amber-200/90">
                <strong>Harmony:</strong> {critique.colorHarmonyNotes}
              </p>

              {critique.darkZoneSuggestions.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Unlit Zones to Consider
                  </div>
                  <ul className="list-inside list-disc space-y-0.5 text-[11px] text-slate-300">
                    {critique.darkZoneSuggestions.map((z, i) => (
                      <li key={i}>{z}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-2 pt-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                  1-Click Concept Variations
                </div>
                {critique.conceptPresets.map((preset, idx) => (
                  <div
                    key={preset.id}
                    className="rounded-xl border border-white/10 bg-white/[0.04] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">
                        {preset.name}
                      </span>
                      <button
                        type="button"
                        data-testid={`btn-preview-concept-${idx}`}
                        onClick={() => applyConceptPreset(preset)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/25"
                      >
                        <Eye className="h-3 w-3" /> Apply
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {preset.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {activeDrawer === 'BOM' && (
        <section className="space-y-3">
          <p className="text-[11px] leading-relaxed text-slate-400">
            Calculates +12% spool slack, HOA-safe mounting clips per surface, 15A
            GFCI circuits, and walk-out balcony vs. exterior ladder sizing.
          </p>

          <button
            type="button"
            data-testid="btn-generate-bom"
            disabled={isGeneratingBom}
            onClick={handleGenerateBom}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-400 py-2.5 text-xs font-semibold text-slate-950 shadow transition hover:bg-amber-300 disabled:opacity-50"
          >
            {isGeneratingBom ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShoppingBag className="h-3.5 w-3.5" />
            )}
            {isGeneratingBom ? 'Building Shopping List…' : 'Generate Hardware BOM'}
          </button>

          {bom && (
            <div data-testid="bom-report" className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="btn-export-bom-csv"
                  onClick={() =>
                    downloadBlob(
                      formatBOMAsCsv(bom, telemetry),
                      'lumen3d-bom.csv',
                      'text/csv;charset=utf-8'
                    )
                  }
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.05] py-2 text-[11px] font-medium text-slate-100 hover:bg-white/[0.1]"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-300" />{' '}
                  Export CSV
                </button>
                <button
                  type="button"
                  data-testid="btn-export-bom-md"
                  onClick={() =>
                    downloadBlob(
                      formatBOMAsMarkdown(bom, telemetry),
                      'lumen3d-bom.md',
                      'text/markdown;charset=utf-8'
                    )
                  }
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.05] py-2 text-[11px] font-medium text-slate-100 hover:bg-white/[0.1]"
                >
                  <FileText className="h-3.5 w-3.5 text-amber-300" /> Export MD
                </button>
              </div>

              <div>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                  Light Spools (+12% Slack)
                </h3>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table
                    data-testid="bom-spools-table"
                    className="w-full text-left text-[11px]"
                  >
                    <thead className="bg-white/[0.05] text-slate-400">
                      <tr>
                        <th className="px-2.5 py-1.5">SKU</th>
                        <th className="px-2 py-1.5 text-right">+12% ft</th>
                        <th className="px-2.5 py-1.5 text-right">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {bom.spools.map((s, idx) => (
                        <tr key={idx}>
                          <td className="px-2.5 py-1.5 text-slate-200">
                            {s.skuDescription}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">
                            {s.paddedLengthFeet.toFixed(1)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-bold tabular-nums text-amber-300">
                            {s.quantityToPurchase}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                  Mounting Clips &amp; Hardware
                </h3>
                <div className="space-y-1.5">
                  {bom.mountingHardware.map((h, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5"
                    >
                      <div className="flex justify-between font-medium text-white">
                        <span>{h.itemDescription}</span>
                        <span className="ml-2 shrink-0 text-amber-300">
                          {h.packCount} pk ({h.quantity})
                        </span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {h.attachmentMethod}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                  Power &amp; Timers
                </h3>
                <div className="space-y-1.5">
                  {bom.powerDistribution.map((p, idx) => (
                    <div
                      key={idx}
                      className="flex items-start justify-between rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-[11px]"
                    >
                      <div>
                        <div className="font-medium text-white">
                          {p.itemDescription}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {p.purpose}
                        </div>
                      </div>
                      <span className="ml-2 shrink-0 font-bold text-emerald-300">
                        x{p.quantity}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" /> Safety &amp; Install Plan
                </h3>
                <ol className="space-y-1.5">
                  {bom.safetyAndInstallPlan.map((step) => (
                    <li
                      key={step.stepNumber}
                      className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-[11px]"
                    >
                      <div className="font-semibold text-white">
                        {step.stepNumber}. {step.phase}
                      </div>
                      <p className="mt-0.5 text-slate-300">{step.instruction}</p>
                      <p className="mt-0.5 text-[10px] text-amber-300/90">
                        Safety: {step.safetyNote}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
