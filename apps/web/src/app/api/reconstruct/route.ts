import { NextResponse } from 'next/server';
import {
  ArchitecturalBuildingSpecSchema,
  ReconstructionJobSchema,
  type ArchitecturalBuildingSpec,
  type MapsBuildingContext,
  type ReconstructionJob,
} from '@lumen3d/shared-schemas';
import {
  getGenAIClient,
  getGeminiModel,
  isGeminiMockMode,
  Type,
  type Schema,
} from '@/lib/gemini/client';
import { fetchGoogleMapsBuildingContext } from '@/lib/maps/buildingContext';

function getWorkerBaseUrl(): string {
  return (process.env.RECON_WORKER_URL || 'http://127.0.0.1:8001').replace(/\/+$/, '');
}

function rewriteJobUrls(job: ReconstructionJob): ReconstructionJob {
  const id = encodeURIComponent(job.jobId);
  return {
    ...job,
    glbUrl: job.glbUrl ? `/api/reconstruct?jobId=${id}&artifact=scene.glb` : undefined,
    camerasUrl: job.camerasUrl
      ? `/api/reconstruct?jobId=${id}&artifact=cameras.json`
      : undefined,
    referenceImageUrl: job.referenceImageUrl
      ? `/api/reconstruct?jobId=${id}&artifact=reference_front.png`
      : undefined,
  };
}

const GEMINI_ARCHITECTURAL_SPEC_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    archetype: {
      type: Type.STRING,
      enum: ['multi_story_condo', 'townhouse', 'single_family_gable', 'modern_box'],
    },
    floors: { type: Type.INTEGER },
    metersPerFloor: { type: Type.NUMBER },
    roofStyle: {
      type: Type.STRING,
      enum: ['flat_parapet', 'pitched_gable', 'hip'],
    },
    roofPitchDegrees: { type: Type.NUMBER },
    wallColorRgb: { type: Type.ARRAY, items: { type: Type.INTEGER } },
    trimColorRgb: { type: Type.ARRAY, items: { type: Type.INTEGER } },
    roofColorRgb: { type: Type.ARRAY, items: { type: Type.INTEGER } },
    windowBaysPerFloor: { type: Type.INTEGER },
    hasGarage: { type: Type.BOOLEAN },
    balconies: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          floor: { type: Type.INTEGER },
          wallFace: {
            type: Type.STRING,
            enum: ['front', 'left', 'right', 'rear'],
          },
          centerOffsetNorm: { type: Type.NUMBER },
          widthMeters: { type: Type.NUMBER },
          depthMeters: { type: Type.NUMBER },
          mountStyle: {
            type: Type.STRING,
            enum: ['cantilevered', 'recessed'],
          },
          railingType: {
            type: Type.STRING,
            enum: ['metal_picket', 'glass_panel', 'solid_parapet'],
          },
        },
        required: [
          'id',
          'floor',
          'wallFace',
          'centerOffsetNorm',
          'widthMeters',
          'depthMeters',
          'mountStyle',
          'railingType',
        ],
      },
    },
    sourceSummary: { type: Type.STRING },
  },
  required: [
    'archetype',
    'floors',
    'metersPerFloor',
    'roofStyle',
    'roofPitchDegrees',
    'wallColorRgb',
    'trimColorRgb',
    'roofColorRgb',
    'windowBaysPerFloor',
    'hasGarage',
    'balconies',
    'sourceSummary',
  ],
};

async function extractSpecWithGeminiIfAvailable(
  uploadedFiles: File[],
  mapsCtx: MapsBuildingContext | null
): Promise<Record<string, unknown> | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (
    isGeminiMockMode() ||
    !geminiKey ||
    geminiKey === 'your_gemini_api_key_here'
  ) {
    if (!mapsCtx) return null;
    // Pass Maps geometric overrides so worker's OpenCV analyzer merges them with pixel analysis
    const partial: Record<string, unknown> = {};
    if (mapsCtx.footprintPolygonMeters) {
      partial.footprintPolygonMeters = mapsCtx.footprintPolygonMeters;
    }
    if (mapsCtx.estimatedFloors !== null) {
      partial.floors = mapsCtx.estimatedFloors;
    }
    if (mapsCtx.roofPitchDegrees !== null) {
      partial.roofPitchDegrees = mapsCtx.roofPitchDegrees;
      partial.roofStyle =
        mapsCtx.roofPitchDegrees < 6 ? 'flat_parapet' : 'pitched_gable';
    }
    partial.sourceSummary = `Google Maps (${mapsCtx.formattedAddress}) + OpenCV facade extraction`;
    return partial;
  }

  try {
    const ai = getGenAIClient();
    const contents: Array<
      | { inlineData: { mimeType: string; data: string } }
      | { text: string }
    > = [];

    const imageFiles = uploadedFiles
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 3);
    for (const imgFile of imageFiles) {
      const buf = Buffer.from(await imgFile.arrayBuffer());
      contents.push({
        inlineData: {
          mimeType: imgFile.type || 'image/png',
          data: buf.toString('base64'),
        },
      });
    }

    if (mapsCtx?.streetViewBase64) {
      contents.push({
        inlineData: {
          mimeType: 'image/png',
          data: mapsCtx.streetViewBase64,
        },
      });
    }

    if (contents.length === 0) {
      return mapsCtx?.footprintPolygonMeters
        ? { footprintPolygonMeters: mapsCtx.footprintPolygonMeters }
        : null;
    }

    const mapsHint = mapsCtx
      ? `Google Maps building context for "${mapsCtx.formattedAddress}": estimatedFloors=${mapsCtx.estimatedFloors ?? 'unknown'}, roofPitchDegrees=${mapsCtx.roofPitchDegrees ?? 'unknown'}.`
      : 'No street address provided.';

    contents.push({
      text: [
        'Extract a 3D ArchitecturalBuildingSpec JSON from these exterior building photos for holiday lighting reconstruction.',
        mapsHint,
        'Identify exact floor count (1..8), roofStyle (flat_parapet, pitched_gable, hip), RGB colors [0..255] for wall/trim/roof, windowBaysPerFloor, and every visible upper-floor or ground balcony (floor 1..8, wallFace front/left/right/rear, centerOffsetNorm -0.35..+0.35, mountStyle cantilevered/recessed, railingType metal_picket/glass_panel/solid_parapet).',
      ].join('\n'),
    });

    const resp = await ai.models.generateContent({
      model: getGeminiModel(),
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_ARCHITECTURAL_SPEC_SCHEMA,
      },
    });

    if (!resp.text) return null;
    const raw = JSON.parse(resp.text) as Record<string, unknown>;
    raw.footprintPolygonMeters = mapsCtx?.footprintPolygonMeters ?? [
      [-6.2, -4.8],
      [6.2, -4.8],
      [6.2, 4.8],
      [-6.2, 4.8],
    ];
    const validated: ArchitecturalBuildingSpec =
      ArchitecturalBuildingSpecSchema.parse(raw);
    return validated as unknown as Record<string, unknown>;
  } catch {
    return mapsCtx?.footprintPolygonMeters
      ? { footprintPolygonMeters: mapsCtx.footprintPolygonMeters }
      : null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const workerBase = getWorkerBaseUrl();
  const contentType = request.headers.get('content-type') || '';

  try {
    let upstreamResp: Response;

    if (contentType.includes('multipart/form-data')) {
      const incomingForm = await request.formData();
      const rawFiles = incomingForm.getAll('files');
      const uploadedFiles = rawFiles.filter(
        (item): item is File => typeof item === 'object' && item !== null && 'arrayBuffer' in item
      );
      const address = String(incomingForm.get('address') || '').trim();
      const explicitSpecJson = String(incomingForm.get('specJson') || '').trim();
      const mode = String(incomingForm.get('mode') || 'auto');

      if (uploadedFiles.length === 0 && !explicitSpecJson) {
        return NextResponse.json(
          {
            error:
              'Upload at least one photo or walkaround video (address enriches uploaded media rather than scraping Maps alone).',
          },
          { status: 400 }
        );
      }

      let mapsCtx: MapsBuildingContext | null = null;
      const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
      if (
        address &&
        mapsKey &&
        mapsKey !== 'your_google_maps_api_key_here'
      ) {
        try {
          mapsCtx = await fetchGoogleMapsBuildingContext(address, mapsKey);
        } catch {
          // Proceed cleanly with photo/video analysis if Maps lookup fails
          mapsCtx = null;
        }
      }

      let specToForward = explicitSpecJson;
      if (!specToForward) {
        const extracted = await extractSpecWithGeminiIfAvailable(
          uploadedFiles,
          mapsCtx
        );
        if (extracted) {
          specToForward = JSON.stringify(extracted);
        }
      }

      const outForm = new FormData();
      for (const f of uploadedFiles) {
        outForm.append('files', f, f.name);
      }
      outForm.append('mode', mode);
      if (specToForward) {
        outForm.append('spec_json', specToForward);
      }

      upstreamResp = await fetch(`${workerBase}/jobs/reconstruct`, {
        method: 'POST',
        body: outForm,
      });
    } else {
      const body = (await request.json().catch(() => ({ demo: true }))) as {
        demo?: boolean;
        preset?: 'condo' | 'house';
        buildingSpec?: unknown;
      };

      if (body.buildingSpec) {
        const validatedSpec = ArchitecturalBuildingSpecSchema.parse(
          body.buildingSpec
        );
        const outForm = new FormData();
        outForm.append('mode', 'architectural');
        outForm.append('spec_json', JSON.stringify(validatedSpec));
        upstreamResp = await fetch(`${workerBase}/jobs/reconstruct`, {
          method: 'POST',
          body: outForm,
        });
      } else {
        const preset = body.preset === 'condo' ? 'condo' : 'house';
        upstreamResp = await fetch(
          `${workerBase}/jobs/demo?preset=${encodeURIComponent(preset)}`,
          { method: 'POST' }
        );
      }
    }

    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text();
      return NextResponse.json(
        { error: `Reconstruction worker error (${upstreamResp.status}): ${errText}` },
        { status: upstreamResp.status }
      );
    }

    const rawJob = await upstreamResp.json();
    const parsed = ReconstructionJobSchema.parse(rawJob);
    return NextResponse.json(rewriteJobUrls(parsed));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reach recon-worker';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(request: Request): Promise<Response> {
  const workerBase = getWorkerBaseUrl();
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  const artifact = searchParams.get('artifact');

  if (!jobId) {
    return NextResponse.json({ error: 'Missing required query param: jobId' }, { status: 400 });
  }

  try {
    if (artifact) {
      const safeArtifact = artifact.replace(/[^a-zA-Z0-9._-]/g, '');
      const artifactResp = await fetch(
        `${workerBase}/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(safeArtifact)}`,
        { cache: 'no-store' }
      );
      if (!artifactResp.ok) {
        return NextResponse.json(
          { error: `Artifact '${safeArtifact}' not found` },
          { status: artifactResp.status }
        );
      }
      const contentType =
        artifactResp.headers.get('content-type') || 'application/octet-stream';
      const arrayBuffer = await artifactResp.arrayBuffer();
      return new Response(arrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
        },
      });
    }

    const statusResp = await fetch(
      `${workerBase}/jobs/${encodeURIComponent(jobId)}`,
      { cache: 'no-store' }
    );
    if (!statusResp.ok) {
      const errText = await statusResp.text();
      return NextResponse.json(
        { error: `Worker job lookup failed: ${errText}` },
        { status: statusResp.status }
      );
    }

    const rawJob = await statusResp.json();
    const parsed = ReconstructionJobSchema.parse(rawJob);
    return NextResponse.json(rewriteJobUrls(parsed));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to poll recon-worker';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
