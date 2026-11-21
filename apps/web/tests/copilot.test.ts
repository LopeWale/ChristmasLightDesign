import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  BOMReportSchema,
  CritiqueReportSchema,
  type LightRun,
} from '@lumen3d/shared-schemas';
import { computeDesignTelemetry } from '../src/lib/geometry/bomMath';
import { recomputeRunBulbPositions } from '../src/lib/geometry/splineGenerators';
import { POST as critiquePost } from '../src/app/api/copilot/critique/route';
import { POST as bomPost } from '../src/app/api/copilot/bom/route';
import { formatBOMAsCsv, formatBOMAsMarkdown } from '../src/lib/bomExport';

function buildSampleRunsAndTelemetry() {
  const scale = 3.28084;
  const eaveBase = {
    id: 'run-eave-front',
    name: 'Front Eave Gutter',
    toolMode: 'LINEAR_EAVE' as const,
    bulbPreset: 'C9_LED' as const,
    spacingInches: 12,
    colorsHex: ['#ffd996'],
    pattern: 'SOLID' as const,
    controlPoints: [
      [-4.5, 3.55, 3.35] as [number, number, number],
      [4.5, 3.55, 3.35] as [number, number, number],
    ],
    surfaceMaterial: 'metal_gutter' as const,
  };
  const eaveRun: LightRun = {
    ...eaveBase,
    bulbPositions: recomputeRunBulbPositions(eaveBase, scale),
  };

  const helixParams = {
    baseCenter: [-1.85, 0.14, 3.68] as [number, number, number],
    topCenter: [-1.85, 3.05, 3.68] as [number, number, number],
    radius: 0.14,
    turns: 6,
  };
  const colBase = {
    id: 'run-col-left',
    name: 'Left Porch Column',
    toolMode: 'HELICAL_WRAP' as const,
    bulbPreset: 'MINI_5MM_LED' as const,
    spacingInches: 4,
    colorsHex: ['#ff1e27', '#ffffff'],
    pattern: 'CANDY_CANE' as const,
    controlPoints: [helixParams.baseCenter, helixParams.topCenter],
    helixParams,
    surfaceMaterial: 'column_post' as const,
  };
  const colRun: LightRun = {
    ...colBase,
    bulbPositions: recomputeRunBulbPositions(colBase, scale),
  };

  const runs = [eaveRun, colRun];
  const telemetry = computeDesignTelemetry({
    runs,
    feetPerSceneUnit: scale,
    calibrationSource: 'AUTO_DOOR',
    groundMinY: 0,
  });

  return { runs, telemetry };
}

describe('Gate 5: Gemini Multimodal Critique, Hardware BOM & CSV/MD Export', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, GEMINI_MOCK_MODE: 'true' };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns validated CritiqueReport with 3 actionable conceptPresets mapped to active runs', async () => {
    const { runs, telemetry } = buildSampleRunsAndTelemetry();
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const req = new Request('http://localhost:3000/api/copilot/critique', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nightSnapshotBase64: tinyPng,
        daylightImageBase64: tinyPng,
        telemetry,
        currentRuns: runs,
        stylePrompt: 'Warm classic architectural',
      }),
    });

    const resp = await critiquePost(req);
    expect(resp.status).toBe(200);
    const json = await resp.json();
    const parsed = CritiqueReportSchema.parse(json);

    expect(parsed.overallScore).toBeGreaterThanOrEqual(1);
    expect(parsed.overallScore).toBeLessThanOrEqual(10);
    expect(parsed.conceptPresets).toHaveLength(3);
    expect(parsed.conceptPresets[0].runMutations.length).toBeGreaterThanOrEqual(2);
    expect(parsed.conceptPresets[0].runMutations[0].runId).toBe('run-eave-front');
  });

  it('returns validated BOMReport with +12% spool slack, surface-matched clips, and exact ladder/circuit plan', async () => {
    const { telemetry } = buildSampleRunsAndTelemetry();

    const req = new Request('http://localhost:3000/api/copilot/bom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telemetry,
        detectedZones: [],
      }),
    });

    const resp = await bomPost(req);
    expect(resp.status).toBe(200);
    const json = await resp.json();
    const bom = BOMReportSchema.parse(json);

    expect(bom.spools.length).toBeGreaterThanOrEqual(2);
    const c9Spool = bom.spools.find((s) => s.bulbPreset === 'C9_LED');
    expect(c9Spool).toBeDefined();
    expect(c9Spool!.paddedLengthFeet).toBeCloseTo(
      c9Spool!.netLengthFeet * 1.12,
      1
    );
    expect(c9Spool!.quantityToPurchase).toBe(
      Math.ceil(c9Spool!.paddedLengthFeet / c9Spool!.unitLengthFeet)
    );

    // Surface-matched clips for metal_gutter and column_post
    expect(
      bom.mountingHardware.some((h) => h.surfaceMaterial === 'metal_gutter')
    ).toBe(true);
    expect(
      bom.mountingHardware.some(
        (h) =>
          h.surfaceMaterial === 'column_post' &&
          h.itemDescription.toLowerCase().includes('zip')
      )
    ).toBe(true);

    // Safety plan references exact recommendedLadderFeet from telemetry
    const ladderStr = `${telemetry.totals.recommendedLadderFeet}`;
    expect(
      bom.safetyAndInstallPlan.some(
        (s) =>
          s.instruction.includes(ladderStr) || s.safetyNote.includes(ladderStr)
      )
    ).toBe(true);

    // Verify CSV & Markdown export formatting
    const csv = formatBOMAsCsv(bom, telemetry);
    expect(csv).toContain('Category,Item / SKU,Quantity');
    expect(csv).toContain('C9');

    const md = formatBOMAsMarkdown(bom, telemetry);
    expect(md).toContain('# Lumen3D Holiday Lighting Bill of Materials');
    expect(md).toContain('## 1. Light Spools');
  });

  it('emits HOA-safe non-drilling railing clamps and VHB soffit clips for condo balconies', async () => {
    const balconyRuns: LightRun[] = [
      {
        id: 'b-rail',
        name: '2F Balcony Railing',
        toolMode: 'LINEAR_EAVE',
        bulbPreset: 'C9_LED',
        spacingInches: 12,
        colorsHex: ['#ffd996'],
        pattern: 'SOLID',
        controlPoints: [
          [-2, 4.2, 5.8],
          [2, 4.2, 5.8],
        ],
        bulbPositions: [
          [-2, 4.2, 5.8],
          [-1, 4.2, 5.8],
          [0, 4.2, 5.8],
          [1, 4.2, 5.8],
          [2, 4.2, 5.8],
        ],
        surfaceMaterial: 'balcony_railing',
      },
      {
        id: 'b-soffit',
        name: '2F Balcony Soffit',
        toolMode: 'LINEAR_EAVE',
        bulbPreset: 'RGB_SOFFIT_PUCK',
        spacingInches: 12,
        colorsHex: ['#ffd996'],
        pattern: 'SOLID',
        controlPoints: [
          [-2, 6.1, 5.2],
          [2, 6.1, 5.2],
        ],
        bulbPositions: [
          [-2, 6.1, 5.2],
          [0, 6.1, 5.2],
          [2, 6.1, 5.2],
        ],
        surfaceMaterial: 'balcony_soffit',
      },
    ];

    const telemetry = computeDesignTelemetry({
      runs: balconyRuns,
      feetPerSceneUnit: 3.28084,
      calibrationSource: 'AUTO_DOOR',
    });

    const req = new Request('http://localhost:3000/api/copilot/bom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telemetry, detectedZones: [] }),
    });
    const resp = await bomPost(req);
    expect(resp.status).toBe(200);
    const bom = BOMReportSchema.parse(await resp.json());

    const railClip = bom.mountingHardware.find(
      (h) => h.surfaceMaterial === 'balcony_railing'
    );
    const soffitClip = bom.mountingHardware.find(
      (h) => h.surfaceMaterial === 'balcony_soffit'
    );

    expect(railClip?.itemDescription).toMatch(/Railing|Clamps/i);
    expect(soffitClip?.itemDescription).toMatch(/VHB|Command/i);
  });
});
