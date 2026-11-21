import { NextResponse } from 'next/server';
import {
  CalibrationDetectionResultSchema,
  type CalibrationDetectionResult,
  type CameraPose,
} from '@lumen3d/shared-schemas';
import {
  getGenAIClient,
  getGeminiModel,
  isGeminiMockMode,
  stripDataUrlPrefix,
  SURFACE_MATERIAL_ENUM_VALUES,
  Type,
  type Schema,
} from '@/lib/gemini/client';

const CALIBRATION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    front_door: {
      type: Type.ARRAY,
      nullable: true,
      items: { type: Type.NUMBER },
      description:
        'Normalized 0..1000 [ymin, xmin, ymax, xmax] bounding box of the primary front entry door (standard 6.67 ft height), or null if not visible.',
    },
    garage_door: {
      type: Type.ARRAY,
      nullable: true,
      items: { type: Type.NUMBER },
      description:
        'Normalized 0..1000 [ymin, xmin, ymax, xmax] bounding box of the main garage door (standard 7.0 ft height), or null if not visible.',
    },
    zones: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          surfaceMaterial: {
            type: Type.STRING,
            enum: SURFACE_MATERIAL_ENUM_VALUES,
          },
          box2d: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
          },
        },
        required: ['label', 'surfaceMaterial', 'box2d'],
      },
    },
    notes: { type: Type.STRING },
  },
  required: ['front_door', 'garage_door', 'zones'],
};

function projectWorldBoxToNormBox2D(
  camera: CameraPose,
  minPt: [number, number, number],
  maxPt: [number, number, number]
): [number, number, number, number] | null {
  // Invert 4x4 orthonormal rigid transform [R | t] -> [R^T | -R^T t]
  const e = camera.extrinsics;
  const r00 = e[0][0], r01 = e[0][1], r02 = e[0][2], tx = e[0][3];
  const r10 = e[1][0], r11 = e[1][1], r12 = e[1][2], ty = e[1][3];
  const r20 = e[2][0], r21 = e[2][1], r22 = e[2][2], tz = e[2][3];

  const fx = camera.intrinsics[0][0];
  const fy = camera.intrinsics[1][1];
  const cx = camera.intrinsics[0][2];
  const cy = camera.intrinsics[1][2];

  const corners: Array<[number, number, number]> = [
    [minPt[0], minPt[1], maxPt[2]],
    [maxPt[0], minPt[1], maxPt[2]],
    [minPt[0], maxPt[1], maxPt[2]],
    [maxPt[0], maxPt[1], maxPt[2]],
  ];

  const us: number[] = [];
  const vs: number[] = [];
  for (const [wx, wy, wz] of corners) {
    const dx = wx - tx;
    const dy = wy - ty;
    const dz = wz - tz;
    const xc = r00 * dx + r10 * dy + r20 * dz;
    const yc = r01 * dx + r11 * dy + r21 * dz;
    const zc = r02 * dx + r12 * dy + r22 * dz;
    if (zc <= 0.2) return null;
    us.push(((fx * (xc / zc) + cx) / camera.width) * 1000.0);
    vs.push(((fy * (yc / zc) + cy) / camera.height) * 1000.0);
  }

  const ymin = Math.max(0, Math.min(999, Math.min(...vs)));
  const ymax = Math.max(ymin + 2, Math.min(1000, Math.max(...vs)));
  const xmin = Math.max(0, Math.min(999, Math.min(...us)));
  const xmax = Math.max(xmin + 2, Math.min(1000, Math.max(...us)));
  return [
    Math.round(ymin * 10) / 10,
    Math.round(xmin * 10) / 10,
    Math.round(ymax * 10) / 10,
    Math.round(xmax * 10) / 10,
  ];
}

function buildMockCalibrationResult(
  camera?: CameraPose,
  doorWorldBox?: { min: [number, number, number]; max: [number, number, number] }
): CalibrationDetectionResult {
  const projectedDoor =
    camera && doorWorldBox
      ? projectWorldBoxToNormBox2D(camera, doorWorldBox.min, doorWorldBox.max)
      : null;

  return {
    front_door: projectedDoor || [491.5, 364.0, 728.4, 426.2],
    garage_door: projectedDoor ? null : [494.0, 715.4, 734.2, 886.4],
    zones: [
      {
        label: 'Main Pitched Gable Roof',
        surfaceMaterial: 'asphalt_shingle',
        box2d: [170, 105, 455, 695],
      },
      {
        label: 'Front Eaves & Gutters',
        surfaceMaterial: 'metal_gutter',
        box2d: [440, 105, 495, 925],
      },
      {
        label: 'Main Brick Facade',
        surfaceMaterial: 'brick_masonry',
        box2d: [455, 125, 730, 680],
      },
      {
        label: 'Front Porch Columns',
        surfaceMaterial: 'column_post',
        box2d: [465, 245, 730, 560],
      },
      {
        label: 'Front Boxwood Shrubs',
        surfaceMaterial: 'foliage_shrub',
        box2d: [655, 165, 755, 635],
      },
      {
        label: 'Front Stone Walkway',
        surfaceMaterial: 'ground_turf',
        box2d: [730, 330, 960, 465],
      },
    ],
    notes: 'Deterministic calibration reference aligned to synthetic front elevation.',
  };
}

const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const SAFE_ARTIFACT_RE = /^[a-zA-Z0-9._-]+$/;

async function resolveImagePayload(body: {
  imageBase64?: string;
  referenceImageUrl?: string;
  jobId?: string;
}): Promise<{ mimeType: string; base64Data: string }> {
  if (body.imageBase64) {
    return stripDataUrlPrefix(body.imageBase64);
  }
  const workerBase = (process.env.RECON_WORKER_URL || 'http://127.0.0.1:8001').replace(
    /\/+$/,
    ''
  );
  let fetchUrl = '';

  if (body.jobId) {
    if (!SAFE_ID_RE.test(body.jobId)) {
      throw new Error('Invalid jobId format');
    }
    fetchUrl = `${workerBase}/jobs/${encodeURIComponent(body.jobId)}/artifacts/reference_front.png`;
  } else if (body.referenceImageUrl) {
    const rawUrl = body.referenceImageUrl.trim();
    if (rawUrl.startsWith('/api/reconstruct')) {
      const parsedUrl = new URL(rawUrl, 'http://localhost:3000');
      const jId = parsedUrl.searchParams.get('jobId') || '';
      const art = parsedUrl.searchParams.get('artifact') || 'reference_front.png';
      if (!SAFE_ID_RE.test(jId) || !SAFE_ARTIFACT_RE.test(art)) {
        throw new Error('Invalid or disallowed referenceImageUrl parameters');
      }
      fetchUrl = `${workerBase}/jobs/${encodeURIComponent(jId)}/artifacts/${encodeURIComponent(art)}`;
    } else {
      const match = rawUrl.match(/^\/jobs\/([a-zA-Z0-9_-]+)\/artifacts\/([a-zA-Z0-9._-]+)$/);
      if (!match) {
        throw new Error('Invalid or disallowed referenceImageUrl; only worker job artifacts are permitted.');
      }
      fetchUrl = `${workerBase}/jobs/${encodeURIComponent(match[1])}/artifacts/${encodeURIComponent(match[2])}`;
    }
  }

  if (!fetchUrl) {
    throw new Error('Provide imageBase64, referenceImageUrl, or jobId for spatial calibration.');
  }

  const resp = await fetch(fetchUrl, { cache: 'no-store' });
  if (!resp.ok) {
    throw new Error(`Failed to fetch reference facade image (${resp.status})`);
  }
  const mimeType = resp.headers.get('content-type') || 'image/png';
  const buf = Buffer.from(await resp.arrayBuffer());
  return {
    mimeType,
    base64Data: buf.toString('base64'),
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      imageBase64?: string;
      referenceImageUrl?: string;
      jobId?: string;
      camera?: CameraPose;
      doorWorldBox?: { min: [number, number, number]; max: [number, number, number] };
    };

    if (isGeminiMockMode()) {
      const mock = CalibrationDetectionResultSchema.parse(
        buildMockCalibrationResult(body.camera, body.doorWorldBox)
      );
      return NextResponse.json(mock);
    }

    const { mimeType, base64Data } = await resolveImagePayload(body);
    const ai = getGenAIClient();

    const promptText = [
      'Analyze this building exterior front facade photo for 3D metric holiday lighting calibration.',
      'Return normalized 0..1000 [ymin, xmin, ymax, xmax] bounding boxes:',
      '1. front_door: exact tight box of the primary front entry door leaf (standard height 6.67 ft), or null if absent.',
      '2. garage_door: exact tight box of the overhead garage door opening (standard height 7.0 ft), or null if absent.',
      '3. zones: major architectural lighting zones (roof shingles, gutters/eaves, fascia, walls, porch columns, shrubs, ground walkway) tagged with SurfaceMaterial.',
    ].join('\n');

    const response = await ai.models.generateContent({
      model: getGeminiModel(),
      contents: [
        { inlineData: { mimeType, data: base64Data } },
        { text: promptText },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: CALIBRATION_SCHEMA,
      },
    });

    const rawText = response.text;
    if (!rawText) {
      throw new Error('Gemini returned an empty calibration response');
    }

    const parsedJson = JSON.parse(rawText);
    const validated = CalibrationDetectionResultSchema.parse(parsedJson);
    return NextResponse.json(validated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Spatial calibration failed';
    const status = message.includes('GEMINI_API_KEY')
      ? 503
      : message.includes('Invalid') || message.includes('Provide imageBase64')
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
