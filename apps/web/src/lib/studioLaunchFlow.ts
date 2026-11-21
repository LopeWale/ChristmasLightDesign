import {
  MapsBuildingContextSchema,
  ReconstructionJobSchema,
  type ReconstructionJob,
} from '@lumen3d/shared-schemas';
import type { TilesAnchor } from '@/store/useStudioStore';

export type AddressLaunchAction =
  | {
      kind: 'LOAD_3D_TILES';
      formattedAddress: string;
      anchor: TilesAnchor;
      attribution: string;
      warnings: string[];
    }
  | {
      kind: 'NEEDS_TILES_API_OR_PHOTOS';
      formattedAddress: string;
      message: string;
      warnings: string[];
    }
  | {
      kind: 'NEEDS_MAPS_KEY';
      message: string;
    };

export async function resolveAddressLaunchAction(
  rawAddress: string,
  fetchImpl: typeof fetch = fetch
): Promise<AddressLaunchAction> {
  const address = rawAddress.trim();
  if (!address) {
    return {
      kind: 'NEEDS_MAPS_KEY',
      message: 'Enter a street address to locate your building.',
    };
  }

  try {
    const [ctxResp, tilesStatusResp] = await Promise.all([
      fetchImpl('/api/maps/building-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      }),
      fetchImpl('/api/maps/tiles/status', { cache: 'no-store' }),
    ]);

    const tilesStatus = tilesStatusResp.ok
      ? ((await tilesStatusResp.json()) as {
          available?: boolean;
          status?: number;
          reason?: string;
        })
      : { available: false, status: tilesStatusResp.status };

    if (!ctxResp.ok) {
      const errJson = (await ctxResp.json().catch(() => ({}))) as {
        error?: string;
      };
      const isMissingKey =
        ctxResp.status === 503 ||
        (errJson.error || '').includes('GOOGLE_MAPS_API_KEY');

      return {
        kind: 'NEEDS_MAPS_KEY',
        message: isMissingKey
          ? 'Add GOOGLE_MAPS_API_KEY (with Geocoding API + Map Tiles API enabled) to .env to stream any real-world address in Photorealistic 3D, or drop facade photos/video below.'
          : errJson.error ||
            'Could not geocode that street address. Check spelling or attach facade photos below.',
      };
    }

    const ctx = MapsBuildingContextSchema.parse(await ctxResp.json());
    if (tilesStatus.available) {
      return {
        kind: 'LOAD_3D_TILES',
        formattedAddress: ctx.formattedAddress,
        anchor: {
          lat: ctx.location.latitude,
          lng: ctx.location.longitude,
          height: ctx.groundElevationMeters ?? 0,
        },
        attribution: ctx.streetViewCopyright || 'Map data © Google',
        warnings: ctx.warnings,
      };
    }

    return {
      kind: 'NEEDS_TILES_API_OR_PHOTOS',
      formattedAddress: ctx.formattedAddress,
      message: `Located "${ctx.formattedAddress}". Enable Map Tiles API on your GOOGLE_MAPS_API_KEY to stream Photorealistic 3D Tiles directly, or attach a facade photo/video to reconstruct with your Maps footprint.`,
      warnings: ctx.warnings,
    };
  } catch {
    return {
      kind: 'NEEDS_MAPS_KEY',
      message:
        'Google Maps lookup is currently offline. Drop facade photos/video below or launch an instant 3D sample model.',
    };
  }
}

export type SamplePresetOutcome =
  | { kind: 'WORKER_JOB'; job: ReconstructionJob; preset: 'condo' | 'house' }
  | { kind: 'CLIENT_PROCEDURAL'; preset: 'condo' | 'house' };

export async function loadSamplePresetWithFallback(
  preset: 'condo' | 'house',
  fetchImpl: typeof fetch = fetch
): Promise<SamplePresetOutcome> {
  try {
    const resp = await fetchImpl('/api/reconstruct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demo: true, preset }),
    });
    if (!resp.ok) {
      return { kind: 'CLIENT_PROCEDURAL', preset };
    }
    const job = ReconstructionJobSchema.parse(await resp.json());
    return { kind: 'WORKER_JOB', job, preset };
  } catch {
    return { kind: 'CLIENT_PROCEDURAL', preset };
  }
}

export interface PollReconstructionOptions {
  fetchImpl?: typeof fetch;
  initialPollMs?: number;
  steadyPollMs?: number;
  inactivityTimeoutMs?: number;
  maxTotalTimeoutMs?: number;
  onProgress?: (job: ReconstructionJob) => void;
}

export async function pollReconstructionJob(
  jobId: string,
  options: PollReconstructionOptions = {}
): Promise<ReconstructionJob> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const initialPollMs = options.initialPollMs ?? 250;
  const steadyPollMs = options.steadyPollMs ?? 500;
  const inactivityTimeoutMs = options.inactivityTimeoutMs ?? 90_000;
  const maxTotalTimeoutMs = options.maxTotalTimeoutMs ?? 240_000;

  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let bestProgress = -1;
  let lastStatus = '';
  let transientErrors = 0;
  let attempt = 0;

  while (Date.now() - startedAt <= maxTotalTimeoutMs) {
    let resp: Response;
    try {
      resp = await fetchImpl(
        `/api/reconstruct?jobId=${encodeURIComponent(jobId)}`,
        { cache: 'no-store' }
      );
    } catch (err) {
      transientErrors += 1;
      if (transientErrors >= 4) {
        throw err instanceof Error
          ? err
          : new Error('Lost connection to reconstruction worker');
      }
      await new Promise((r) => setTimeout(r, steadyPollMs));
      continue;
    }

    const data = (await resp.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!resp.ok) {
      if (resp.status >= 500 && transientErrors < 3) {
        transientErrors += 1;
        await new Promise((r) => setTimeout(r, steadyPollMs));
        continue;
      }
      throw new Error(
        typeof data.error === 'string'
          ? data.error
          : 'Failed to poll reconstruction job'
      );
    }

    transientErrors = 0;
    const parsed = ReconstructionJobSchema.parse(data);
    options.onProgress?.(parsed);

    if (parsed.progress > bestProgress || parsed.status !== lastStatus) {
      bestProgress = Math.max(bestProgress, parsed.progress);
      lastStatus = parsed.status;
      lastProgressAt = Date.now();
    }

    if (parsed.status === 'completed') {
      return parsed;
    }

    if (parsed.status === 'failed') {
      throw new Error(parsed.error || '3D reconstruction failed');
    }

    if (Date.now() - lastProgressAt > inactivityTimeoutMs) {
      throw new Error(
        `Reconstruction stalled at ${parsed.progress}% (${parsed.status}). Try a shorter clip or restart \`npm run dev\`.`
      );
    }

    const waitMs = attempt < 12 ? initialPollMs : steadyPollMs;
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  throw new Error('Timed out waiting for reconstruction job');
}
