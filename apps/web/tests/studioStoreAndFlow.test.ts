import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveAddressLaunchAction,
  loadSamplePresetWithFallback,
} from '../src/lib/studioLaunchFlow';
import { GET as reconstructGet } from '../src/app/api/reconstruct/route';
import { useStudioStore } from '../src/store/useStudioStore';

describe('Task 4: Progressive Studio Launch Flow & Zero-Failure Fallback', () => {
  beforeEach(() => {
    useStudioStore.getState().resetToLauncher();
  });

  it('transitions directly to MAPS_3D_TILES when Geocoding and Map Tiles API succeed', async () => {
    const stubFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/maps/building-context')) {
        return new Response(
          JSON.stringify({
            formattedAddress: '1007 N Shartel Ave, Oklahoma City, OK 73103, USA',
            location: { latitude: 35.4785, longitude: -97.5256 },
            footprintPolygonMeters: null,
            groundElevationMeters: 368.4,
            streetFacingHeadingDeg: 180,
            estimatedHeightMeters: 10.2,
            estimatedFloors: 3,
            roofPitchDegrees: 2,
            streetViewBase64: null,
            streetViewMimeType: null,
            streetViewCopyright: '© 2026 Google',
            warnings: [],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/api/maps/tiles/status')) {
        return new Response(
          JSON.stringify({ available: true, status: 200 }),
          { status: 200 }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const action = await resolveAddressLaunchAction(
      '1007 N Shartel Ave Oklahoma City Ok',
      stubFetch
    );
    expect(action.kind).toBe('LOAD_3D_TILES');
    if (action.kind === 'LOAD_3D_TILES') {
      expect(action.anchor.lat).toBeCloseTo(35.4785, 4);
      expect(action.anchor.height).toBeCloseTo(368.4, 1);
      expect(action.formattedAddress).toContain('1007 N Shartel Ave');
    }
  });

  it('returns ToS-compliant setup guidance when Map Tiles API is 403 without synthesizing Maps-only .glb', async () => {
    const stubFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/maps/building-context')) {
        return new Response(
          JSON.stringify({
            formattedAddress: '1007 N Shartel Ave, Oklahoma City, OK 73103, USA',
            location: { latitude: 35.4785, longitude: -97.5256 },
            footprintPolygonMeters: [
              [-6, -5],
              [6, -5],
              [6, 5],
              [-6, 5],
            ],
            groundElevationMeters: 368.4,
            streetFacingHeadingDeg: 180,
            estimatedHeightMeters: 9.8,
            estimatedFloors: 3,
            roofPitchDegrees: 2,
            streetViewBase64: null,
            streetViewMimeType: null,
            streetViewCopyright: '© 2026 Google',
            warnings: [],
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          available: false,
          status: 403,
          reason: 'Map Tiles API is not enabled on GOOGLE_MAPS_API_KEY yet.',
        }),
        { status: 200 }
      );
    };

    const action = await resolveAddressLaunchAction(
      '1007 N Shartel Ave Oklahoma City Ok',
      stubFetch
    );
    expect(action.kind).toBe('NEEDS_TILES_API_OR_PHOTOS');
    if (action.kind === 'NEEDS_TILES_API_OR_PHOTOS') {
      expect(action.message).toMatch(/Map Tiles API/i);
      expect(action.message.toLowerCase()).not.toContain('fetch failed');
    }
  });

  it('falls back seamlessly to instant client-side 3-story condo when recon-worker returns 502 or network error', async () => {
    const failingWorkerFetch: typeof fetch = async () => {
      return new Response(JSON.stringify({ error: 'fetch failed' }), {
        status: 502,
      });
    };

    const outcome = await loadSamplePresetWithFallback(
      'condo',
      failingWorkerFetch
    );
    expect(outcome.kind).toBe('CLIENT_PROCEDURAL');
    expect(outcome.preset).toBe('condo');
  });

  it('sets explicit Content-Length header on GET /api/reconstruct?artifact=scene.splat and bundles local Draco decoders', async () => {
    const origFetch = globalThis.fetch;
    const splatPayload = new Uint8Array(64);
    globalThis.fetch = (async () =>
      new Response(splatPayload, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      })) as typeof fetch;

    try {
      const resp = await reconstructGet(
        new Request(
          'http://localhost:3000/api/reconstruct?jobId=job-1&artifact=scene.splat'
        )
      );
      expect(resp.status).toBe(200);
      expect(resp.headers.get('content-length')).toBe('64');
    } finally {
      globalThis.fetch = origFetch;
    }

    const dracoWasm = path.resolve(
      __dirname,
      '../public/draco/draco_decoder.wasm'
    );
    expect(fs.existsSync(dracoWasm)).toBe(true);
  });
});
