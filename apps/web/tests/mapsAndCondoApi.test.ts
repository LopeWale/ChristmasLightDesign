import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { MapsBuildingContextSchema } from '@lumen3d/shared-schemas';
import {
  latLngRingToLocalMeters,
  fetchGoogleMapsBuildingContext,
  mapsContextToPartialOverrides,
} from '../src/lib/maps/buildingContext';
import { POST as mapsPost } from '../src/app/api/maps/building-context/route';
import { useStudioStore } from '../src/store/useStudioStore';

describe('Task 3: Google Maps Building Context & Condo Extraction API', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('converts GeoJSON [lng, lat] displayPolygon into centered metric [x, z] footprint aligned to street bearing', () => {
    // At lat = 0.0 (equator): 1 deg lat ≈ 111,132 m, 1 deg lng ≈ 111,319.5 m
    // Build a 12m (east-west) x 10m (north-south) rectangle
    const dLng = 6.0 / 111319.5;
    const dLat = 5.0 / 111132.0;
    const ring: Array<[number, number]> = [
      [-dLng, -dLat],
      [dLng, -dLat],
      [dLng, dLat],
      [-dLng, dLat],
      [-dLng, -dLat], // closing vertex
    ];

    // Street camera is due south (bearing from building to street = 180 deg -> south edge faces +Z)
    const localPts = latLngRingToLocalMeters(ring, 180);
    expect(localPts.length).toBe(4);

    const xs = localPts.map((p) => p[0]);
    const zs = localPts.map((p) => p[1]);
    const widthM = Math.max(...xs) - Math.min(...xs);
    const depthM = Math.max(...zs) - Math.min(...zs);

    expect(Math.abs(widthM - 12.0) / 12.0).toBeLessThan(0.01);
    expect(Math.abs(depthM - 10.0) / 10.0).toBeLessThan(0.01);
  });

  it('fetches Geocoding v4 displayPolygon, Street View bearing, and Solar roof height with X-Goog-Maps-Solution-ID header', async () => {
    const capturedHeaders: Array<Record<string, string>> = [];

    const stubFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const hdrs = new Headers(init?.headers);
      const headerObj: Record<string, string> = {};
      hdrs.forEach((v, k) => {
        headerObj[k.toLowerCase()] = v;
      });
      capturedHeaders.push(headerObj);

      if (url.includes('geocode.googleapis.com/v4/geocode/destinations')) {
        return new Response(
          JSON.stringify({
            destinations: [
              {
                primary: {
                  formattedAddress: '450 Lakeshore Condo Dr, Chicago, IL 60611, USA',
                  location: { latitude: 41.892, longitude: -87.615 },
                  displayPolygon: {
                    type: 'Polygon',
                    coordinates: [
                      [
                        [-87.61508, 41.89195],
                        [-87.61492, 41.89195],
                        [-87.61492, 41.89205],
                        [-87.61508, 41.89205],
                        [-87.61508, 41.89195],
                      ],
                    ],
                  },
                },
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.includes('maps.googleapis.com/maps/api/streetview/metadata')) {
        return new Response(
          JSON.stringify({
            status: 'OK',
            copyright: '© 2026 Google',
            location: { lat: 41.8918, lng: -87.615 },
          }),
          { status: 200 }
        );
      }

      if (url.includes('maps.googleapis.com/maps/api/streetview?')) {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }

      if (url.includes('maps.googleapis.com/maps/api/elevation/json')) {
        return new Response(
          JSON.stringify({
            status: 'OK',
            results: [{ elevation: 180.0 }],
          }),
          { status: 200 }
        );
      }

      if (url.includes('solar.googleapis.com/v1/buildingInsights:findClosest')) {
        return new Response(
          JSON.stringify({
            solarPotential: {
              roofSegmentStats: [
                {
                  pitchDegrees: 2.0,
                  planeHeightAtCenterMeters: 189.6, // 9.6m above 180.0m ground -> 3 floors
                },
              ],
            },
          }),
          { status: 200 }
        );
      }

      return new Response('Not found', { status: 404 });
    };

    const ctx = await fetchGoogleMapsBuildingContext(
      '450 Lakeshore Condo Dr, Chicago, IL',
      'fake-maps-key',
      stubFetch
    );

    const validated = MapsBuildingContextSchema.parse(ctx);
    expect(validated.formattedAddress).toContain('450 Lakeshore Condo Dr');
    expect(validated.footprintPolygonMeters).not.toBeNull();
    expect(validated.estimatedFloors).toBe(3);
    expect(validated.roofPitchDegrees).toBeCloseTo(2.0, 2);
    expect(validated.streetViewCopyright).toBe('© 2026 Google');

    // Every outbound Google Maps REST call must carry X-Goog-Maps-Solution-ID
    expect(capturedHeaders.length).toBeGreaterThanOrEqual(4);
    for (const h of capturedHeaders) {
      expect(h['x-goog-maps-solution-id']).toBe('gmp_git_agentskills_v1');
    }
  });

  it('degrades gracefully when Solar API returns 403 on a Google Maps Demo Key', async () => {
    const stubFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('geocode.googleapis.com/v4/geocode/destinations')) {
        return new Response(
          JSON.stringify({
            destinations: [
              {
                primary: {
                  formattedAddress: '100 Demo St, Austin, TX 78701, USA',
                  location: { latitude: 30.2672, longitude: -97.7431 },
                  displayPolygon: {
                    type: 'Polygon',
                    coordinates: [
                      [
                        [-97.74316, 30.26715],
                        [-97.74304, 30.26715],
                        [-97.74304, 30.26725],
                        [-97.74316, 30.26725],
                        [-97.74316, 30.26715],
                      ],
                    ],
                  },
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('streetview/metadata')) {
        return new Response(JSON.stringify({ status: 'ZERO_RESULTS' }), { status: 200 });
      }
      // Solar & Elevation return 403 on Demo Key
      return new Response(JSON.stringify({ error: 'API not enabled for demo key' }), {
        status: 403,
      });
    };

    const ctx = await fetchGoogleMapsBuildingContext(
      '100 Demo St, Austin, TX',
      'demo-key',
      stubFetch
    );
    const parsed = MapsBuildingContextSchema.parse(ctx);
    expect(parsed.footprintPolygonMeters).not.toBeNull();
    expect(parsed.estimatedFloors).toBeNull();
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it('rejects missing GOOGLE_MAPS_API_KEY in POST /api/maps/building-context with 503', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const req = new Request('http://localhost:3000/api/maps/building-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '450 Lakeshore Condo Dr, Chicago, IL' }),
    });
    const resp = await mapsPost(req);
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.error).toMatch(/GOOGLE_MAPS_API_KEY/);
  });

  it('preserves streetViewMimeType image/jpeg, builds full partial overrides, and tracks UI Maps attribution', async () => {
    const stubFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('geocode.googleapis.com/v4/geocode/destinations')) {
        return new Response(
          JSON.stringify({
            destinations: [
              {
                primary: {
                  formattedAddress: '200 Condo Way, Seattle, WA 98101',
                  location: { latitude: 47.6062, longitude: -122.3321 },
                  displayPolygon: {
                    type: 'Polygon',
                    coordinates: [
                      [
                        [-122.33218, 47.60615],
                        [-122.33202, 47.60615],
                        [-122.33202, 47.60625],
                        [-122.33218, 47.60625],
                        [-122.33218, 47.60615],
                      ],
                    ],
                  },
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('streetview/metadata')) {
        return new Response(
          JSON.stringify({
            status: 'OK',
            copyright: '© 2026 Google',
            location: { lat: 47.606, lng: -122.3321 },
          }),
          { status: 200 }
        );
      }
      if (url.includes('maps.googleapis.com/maps/api/streetview?')) {
        return new Response(new Uint8Array([255, 216, 255]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      if (url.includes('elevation')) {
        return new Response(JSON.stringify({ results: [{ elevation: 50.0 }] }), {
          status: 200,
        });
      }
      if (url.includes('buildingInsights')) {
        return new Response(
          JSON.stringify({
            solarPotential: {
              roofSegmentStats: [{ pitchDegrees: 1.5, planeHeightAtCenterMeters: 62.4 }],
            },
          }),
          { status: 200 }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const ctx = await fetchGoogleMapsBuildingContext(
      '200 Condo Way, Seattle, WA',
      'fake-key',
      stubFetch
    );
    expect(ctx.streetViewMimeType).toBe('image/jpeg');

    const overrides = mapsContextToPartialOverrides(ctx);
    expect(overrides.floors).toBe(4);
    expect(overrides.roofStyle).toBe('flat_parapet');
    expect(Array.isArray(overrides.footprintPolygonMeters)).toBe(true);

    useStudioStore.getState().setMapsStatus('© 2026 Google', ['Solar fallback']);
    expect(useStudioStore.getState().mapsAttribution).toBe('© 2026 Google');
    expect(useStudioStore.getState().mapsWarnings).toEqual(['Solar fallback']);
  });
});
