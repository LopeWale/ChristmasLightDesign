import { NextResponse } from 'next/server';
import {
  CritiqueReportSchema,
  DesignTelemetrySchema,
  type CritiqueReport,
  type DesignTelemetry,
  type LightRun,
} from '@lumen3d/shared-schemas';
import {
  BULB_PRESET_ENUM_VALUES,
  getGenAIClient,
  getGeminiModel,
  isGeminiMockMode,
  LIGHT_PATTERN_ENUM_VALUES,
  stripDataUrlPrefix,
  Type,
  type Schema,
} from '@/lib/gemini/client';

const CRITIQUE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    overallScore: { type: Type.NUMBER },
    architecturalCritique: { type: Type.STRING },
    colorHarmonyNotes: { type: Type.STRING },
    darkZoneSuggestions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    conceptPresets: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          runMutations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                runId: { type: Type.STRING },
                bulbPreset: {
                  type: Type.STRING,
                  enum: BULB_PRESET_ENUM_VALUES,
                },
                colorsHex: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                pattern: {
                  type: Type.STRING,
                  enum: LIGHT_PATTERN_ENUM_VALUES,
                },
                spacingInches: { type: Type.NUMBER },
              },
              required: ['bulbPreset', 'colorsHex', 'pattern', 'spacingInches'],
            },
          },
          suggestedNewZones: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: [
          'id',
          'name',
          'description',
          'runMutations',
          'suggestedNewZones',
        ],
      },
    },
  },
  required: [
    'overallScore',
    'architecturalCritique',
    'colorHarmonyNotes',
    'darkZoneSuggestions',
    'conceptPresets',
  ],
};

function buildMockCritiqueReport(
  telemetry: DesignTelemetry,
  currentRuns: LightRun[],
  stylePrompt?: string
): CritiqueReport {
  const targetRuns =
    currentRuns.length > 0
      ? currentRuns.map((r) => ({ id: r.id, toolMode: r.toolMode }))
      : telemetry.runs.map((r) => ({ id: r.id, toolMode: r.toolMode }));

  const fallbackRuns =
    targetRuns.length > 0
      ? targetRuns
      : [{ id: 'default-run', toolMode: 'LINEAR_EAVE' as const }];

  const styleHint = stylePrompt ? ` ("${stylePrompt}")` : '';

  return {
    overallScore: telemetry.runs.length >= 2 ? 8.6 : 7.4,
    architecturalCritique: `Your current installation spans ${telemetry.totals.totalLengthFeet.toFixed(1)} ft (${telemetry.totals.totalBulbs} bulbs, ${telemetry.totals.totalWatts.toFixed(1)}W)${styleHint}, framing the primary roofline silhouette cleanly while leaving room to balance ground-level depth along the walkway and boxwood shrubs.`,
    colorHarmonyNotes:
      'High-CRI warm white and crisp ruby accents complement the warm masonry facade without washing out architectural trim shadows in Night-Bloom mode.',
    darkZoneSuggestions: [
      'Garage front eave overhang for horizontal facade continuity',
      'Left & right boxwood shrubs using 5mm wide-angle mini foliage scatter',
      'Front stone walkway border using 24-inch C9 ground stakes',
    ],
    conceptPresets: [
      {
        id: 'concept-warm-architectural',
        name: 'Warm Architectural Estate',
        description:
          'Timeless 2700K warm-white C9 faceted rooflines paired with tight 4-inch warm-white 5mm column wraps.',
        runMutations: fallbackRuns.map((r) => ({
          runId: r.id,
          bulbPreset:
            r.toolMode === 'HELICAL_WRAP' || r.toolMode === 'SURFACE_SCATTER'
              ? 'MINI_5MM_LED'
              : r.toolMode === 'PATHWAY_STAKE'
                ? 'PATHWAY_C9_STAKE'
                : 'C9_LED',
          colorsHex: ['#ffd996'],
          pattern: 'SOLID',
          spacingInches:
            r.toolMode === 'HELICAL_WRAP'
              ? 4
              : r.toolMode === 'PATHWAY_STAKE'
                ? 24
                : 12,
        })),
        suggestedNewZones: [
          'Outline front entry cross-gable peak with 12" warm white C9 bulbs',
          'Frame stone walkway with matching warm white C9 stakes',
        ],
      },
      {
        id: 'concept-candy-cane-splendor',
        name: 'Candy Cane Heritage',
        description:
          'High-energy 3x3 ruby red and pure snow-white candy-cane stripes across eaves and helical porch columns.',
        runMutations: fallbackRuns.map((r) => ({
          runId: r.id,
          bulbPreset:
            r.toolMode === 'HELICAL_WRAP' || r.toolMode === 'SURFACE_SCATTER'
              ? 'MINI_5MM_LED'
              : r.toolMode === 'PATHWAY_STAKE'
                ? 'PATHWAY_C9_STAKE'
                : 'C9_LED',
          colorsHex: ['#ff1e27', '#ffffff'],
          pattern: 'CANDY_CANE',
          spacingInches:
            r.toolMode === 'HELICAL_WRAP'
              ? 4
              : r.toolMode === 'PATHWAY_STAKE'
                ? 24
                : 10,
        })),
        suggestedNewZones: [
          'Wrap second porch column in matching 6-turn candy-cane helix',
          'Add alternating red/white C9 stakes flanking front walkway',
        ],
      },
      {
        id: 'concept-nordic-icicle-twinkle',
        name: 'Nordic Frost & Icicle Twinkle',
        description:
          'Glistening glacial blue and diamond white icicle drops along eaves with animated twinkle column and bush accents.',
        runMutations: fallbackRuns.map((r) => ({
          runId: r.id,
          bulbPreset:
            r.toolMode === 'LINEAR_EAVE'
              ? 'ICICLE_DROP_LED'
              : r.toolMode === 'PATHWAY_STAKE'
                ? 'PATHWAY_C9_STAKE'
                : 'MINI_5MM_LED',
          colorsHex: ['#e0f4ff', '#5cb8ff'],
          pattern: 'TWINKLE',
          spacingInches:
            r.toolMode === 'LINEAR_EAVE'
              ? 6
              : r.toolMode === 'PATHWAY_STAKE'
                ? 24
                : 5,
        })),
        suggestedNewZones: [
          'Scatter 5mm twinkle nets across both front boxwood shrubs',
        ],
      },
    ],
  };
}

async function fetchOptionalDaylightBase64(body: {
  daylightImageBase64?: string;
  daylightImageUrl?: string;
  jobId?: string;
}): Promise<{ mimeType: string; base64Data: string } | null> {
  if (body.daylightImageBase64) {
    return stripDataUrlPrefix(body.daylightImageBase64);
  }
  const workerBase = (process.env.RECON_WORKER_URL || 'http://127.0.0.1:8001').replace(
    /\/+$/,
    ''
  );
  let targetUrl = '';
  if (body.jobId) {
    targetUrl = `${workerBase}/jobs/${encodeURIComponent(body.jobId)}/artifacts/reference_front.png`;
  } else if (body.daylightImageUrl?.startsWith('/api/reconstruct')) {
    const u = new URL(body.daylightImageUrl, 'http://localhost:3000');
    const jId = u.searchParams.get('jobId');
    if (jId) {
      targetUrl = `${workerBase}/jobs/${encodeURIComponent(jId)}/artifacts/reference_front.png`;
    }
  }
  if (!targetUrl) return null;

  try {
    const resp = await fetch(targetUrl, { cache: 'no-store' });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    return {
      mimeType: resp.headers.get('content-type') || 'image/png',
      base64Data: buf.toString('base64'),
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      daylightImageBase64?: string;
      daylightImageUrl?: string;
      jobId?: string;
      nightSnapshotBase64: string;
      telemetry: unknown;
      currentRuns?: LightRun[];
      stylePrompt?: string;
    };

    const telemetry = DesignTelemetrySchema.parse(body.telemetry);
    const currentRuns = Array.isArray(body.currentRuns) ? body.currentRuns : [];

    if (isGeminiMockMode()) {
      const mock = CritiqueReportSchema.parse(
        buildMockCritiqueReport(telemetry, currentRuns, body.stylePrompt)
      );
      return NextResponse.json(mock);
    }

    const ai = getGenAIClient();
    const contents: Array<
      | { inlineData: { mimeType: string; data: string } }
      | { text: string }
    > = [];

    const daylightImg = await fetchOptionalDaylightBase64(body);
    if (daylightImg && daylightImg.base64Data) {
      contents.push({
        inlineData: {
          mimeType: daylightImg.mimeType,
          data: daylightImg.base64Data,
        },
      });
    }

    if (body.nightSnapshotBase64) {
      const nightImg = stripDataUrlPrefix(body.nightSnapshotBase64);
      if (nightImg.base64Data) {
        contents.push({
          inlineData: {
            mimeType: nightImg.mimeType,
            data: nightImg.base64Data,
          },
        });
      }
    }

    const runSummary = currentRuns.map((r) => ({
      runId: r.id,
      name: r.name,
      toolMode: r.toolMode,
      bulbPreset: r.bulbPreset,
      colorsHex: r.colorsHex,
      pattern: r.pattern,
      spacingInches: r.spacingInches,
    }));

    const promptText = [
      'You are an architectural holiday lighting designer reviewing a 3D exterior installation.',
      body.stylePrompt
        ? `User style direction: "${body.stylePrompt}".`
        : 'User style direction: Balanced upscale architectural holiday display.',
      `Deterministic DesignTelemetry JSON (DO NOT recalculate footage or watts): ${JSON.stringify(telemetry)}`,
      `Active LightRuns (preserve exact runId in runMutations so 1-click preview works): ${JSON.stringify(runSummary)}`,
      'Return structured JSON with overallScore (1..10), architecturalCritique, colorHarmonyNotes, darkZoneSuggestions, and EXACTLY 3 distinct conceptPresets.',
      'Every hex color in colorsHex MUST be 6-digit #RRGGBB format (e.g. #ffd996, #ff1e27, #ffffff).',
    ].join('\n\n');

    contents.push({ text: promptText });

    const response = await ai.models.generateContent({
      model: getGeminiModel(),
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: CRITIQUE_RESPONSE_SCHEMA,
      },
    });

    if (!response.text) {
      throw new Error('Gemini returned an empty critique response');
    }

    const raw = JSON.parse(response.text);
    if (Array.isArray(raw.conceptPresets)) {
      raw.conceptPresets = raw.conceptPresets.slice(0, 3);
    }
    const validated = CritiqueReportSchema.parse(raw);
    return NextResponse.json(validated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Co-Pilot critique failed';
    const status = message.includes('GEMINI_API_KEY') ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
