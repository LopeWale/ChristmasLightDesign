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
