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
      className="flex h-full w-96 shrink-0 flex-col gap-3 overflow-y-auto border-l border-studio-border bg-studio-panel p-3.5 text-xs text-slate-200"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-bold text-slate-100">
            Gemini Design Co-Pilot &amp; BOM
          </h2>
        </div>
      </div>

      {errorMsg && (
        <div
          data-testid="copilot-error"
          className="rounded-lg border border-rose-500/40 bg-rose-950/60 p-2.5 text-[11px] text-rose-200"
        >
          {errorMsg}
        </div>
      )}

      {/* Section 1: Multimodal Night-Render Critique & Concept Presets */}
      <section className="rounded-xl border border-slate-800 bg-slate-950/75 p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          1. Multimodal Critique &amp; Concept Variations
        </div>

        <input
          type="text"
          data-testid="input-style-prompt"
          value={stylePrompt}
          onChange={(e) => setStylePrompt(e.target.value)}
          placeholder="Style goal (e.g., Warm classic architectural)"
          className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
        />

        <div className="mb-2.5 flex flex-wrap gap-1">
          {QUICK_STYLE_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setStylePrompt(chip)}
              className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300 ring-1 ring-slate-700 hover:bg-slate-800"
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
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 py-2 font-semibold text-slate-950 shadow transition hover:bg-amber-400 disabled:opacity-50"
        >
          {isCritiquing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {isCritiquing ? 'Analyzing Night Render…' : 'Critique Night Render'}
        </button>

        {critique && (
          <div data-testid="critique-results" className="mt-3 space-y-2.5">
            <div className="flex items-center justify-between rounded-lg bg-slate-900 px-2.5 py-2">
              <span className="text-[11px] font-medium text-slate-300">
                Architectural Lighting Score
              </span>
              <span
                data-testid="critique-score"
                className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-sm font-bold text-emerald-300 ring-1 ring-emerald-400/40"
              >
                {critique.overallScore.toFixed(1)} / 10
              </span>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-300">
              {critique.architecturalCritique}
            </p>
            <p className="text-[11px] leading-relaxed text-amber-200/90">
              <strong>Harmony:</strong> {critique.colorHarmonyNotes}
            </p>

            {critique.darkZoneSuggestions.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">
                  Dark Zones to Fill
                </div>
                <ul className="list-inside list-disc space-y-0.5 text-[11px] text-slate-300">
                  {critique.darkZoneSuggestions.map((z, i) => (
                    <li key={i}>{z}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2 pt-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                3 Interactive Concept Presets
              </div>
              {critique.conceptPresets.map((preset, idx) => (
                <div
                  key={preset.id}
                  className="rounded-lg border border-slate-800 bg-slate-900/90 p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-100">
                      {preset.name}
                    </span>
                    <button
                      type="button"
                      data-testid={`btn-preview-concept-${idx}`}
                      onClick={() => applyConceptPreset(preset)}
                      className="inline-flex shrink-0 items-center gap-1 rounded bg-sky-500 px-2 py-1 text-[10px] font-semibold text-slate-950 hover:bg-sky-400"
                    >
                      <Eye className="h-3 w-3" /> Preview Concept
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

      {/* Section 2: Surface-Aware Hardware & Electrical BOM */}
      <section className="rounded-xl border border-slate-800 bg-slate-950/75 p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          2. Hardware &amp; Electrical Shopping Plan
        </div>

        <button
          type="button"
          data-testid="btn-generate-bom"
          disabled={isGeneratingBom}
          onClick={handleGenerateBom}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 py-2 font-semibold text-slate-950 shadow transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {isGeneratingBom ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShoppingBag className="h-3.5 w-3.5" />
          )}
          {isGeneratingBom ? 'Building BOM…' : 'Generate Hardware BOM'}
        </button>

        {bom && (
          <div data-testid="bom-report" className="mt-3 space-y-3">
            {/* Export Buttons */}
            <div className="grid grid-cols-2 gap-1.5">
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
                className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-900 py-1.5 text-[11px] font-medium text-emerald-300 hover:bg-slate-800"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Export CSV
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
                className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-900 py-1.5 text-[11px] font-medium text-sky-300 hover:bg-slate-800"
              >
                <FileText className="h-3.5 w-3.5" /> Export Markdown
              </button>
            </div>

            {/* Spools Table */}
            <div>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                Light Spools (+12% Slack)
              </h3>
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table
                  data-testid="bom-spools-table"
                  className="w-full text-left text-[11px]"
                >
                  <thead className="bg-slate-900 text-slate-400">
                    <tr>
                      <th className="px-2 py-1">SKU</th>
                      <th className="px-2 py-1 text-right">+12% ft</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {bom.spools.map((s, idx) => (
                      <tr key={idx}>
                        <td className="px-2 py-1.5 text-slate-200">
                          {s.skuDescription}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">
                          {s.paddedLengthFeet.toFixed(1)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold tabular-nums text-emerald-300">
                          {s.quantityToPurchase}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mounting Clips Table */}
            <div>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                Surface Mounting Hardware
              </h3>
              <div className="space-y-1.5">
                {bom.mountingHardware.map((h, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 p-2"
                  >
                    <div className="flex justify-between font-medium text-slate-200">
                      <span>{h.itemDescription}</span>
                      <span className="ml-2 shrink-0 text-sky-300">
                        {h.packCount} pk ({h.quantity} clips)
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      {h.attachmentMethod}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Power Distribution */}
            <div>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-purple-300">
                Power Distribution &amp; Timers
              </h3>
              <div className="space-y-1">
                {bom.powerDistribution.map((p, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between rounded-lg border border-slate-800 bg-slate-900/70 p-2 text-[11px]"
                  >
                    <div>
                      <div className="font-medium text-slate-200">
                        {p.itemDescription}
                      </div>
                      <div className="text-[10px] text-slate-400">{p.purpose}</div>
                    </div>
                    <span className="ml-2 shrink-0 font-bold text-purple-300">
                      x{p.quantity}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Safety & Install Steps */}
            <div>
              <h3 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" /> Safety &amp; Install Plan
              </h3>
              <ol className="space-y-1.5">
                {bom.safetyAndInstallPlan.map((step) => (
                  <li
                    key={step.stepNumber}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 p-2 text-[11px]"
                  >
                    <div className="font-semibold text-slate-100">
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
    </aside>
  );
}
