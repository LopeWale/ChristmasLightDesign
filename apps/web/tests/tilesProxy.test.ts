import { describe, expect, it } from 'vitest';
import {
  rewriteTilesetJsonUris,
  proxyGoogle3DTilesRequest,
  checkGoogle3DTilesAvailability,
} from '../src/lib/maps/tilesProxy';
import { fetchGoogleMapsBuildingContext } from '../src/lib/maps/buildingContext';

describe('Task 2: Google Photorealistic 3D Tiles Server-Side Proxy & Status', () => {
  it('rewrites root-relative and absolute tile.googleapis.com URIs to /api/maps/tiles/v1/3dtiles/', () => {
    const rawJson = JSON.stringify({
      asset: { version: '1.1' },
      root: {
        content: {
          uri: '/v1/3dtiles/datasets/CgA/files/r0.json?session=abc123',
        },
        children: [
          {
            content: {
              uri: 'https://tile.googleapis.com/v1/3dtiles/datasets/CgA/files/tile_01.glb?session=abc123',
            },
          },
        ],
      },
    });

    const rewritten = JSON.parse(rewriteTilesetJsonUris(rawJson));
    expect(rewritten.root.content.uri).toBe(
      '/api/maps/tiles/v1/3dtiles/datasets/CgA/files/r0.json?session=abc123'
    );
    expect(rewritten.root.children[0].content.uri).toBe(
      '/api/maps/tiles/v1/3dtiles/datasets/CgA/files/tile_01.glb?session=abc123'
    );
  });

  it('strips dummy client key, injects server GOOGLE_MAPS_API_KEY + GMP header, and preserves binary .glb bytes', async () => {
    let seenUrl = '';
    let seenSolutionHeader = '';
    const glbMagic = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]);

    const stubFetch: typeof fetch = async (input, init) => {
      seenUrl = typeof input === 'string' ? input : input.toString();
      const hdrs = new Headers(init?.headers);
      seenSolutionHeader = hdrs.get('x-goog-maps-solution-id') || '';

      if (seenUrl.includes('root.json')) {
        return new Response(
          JSON.stringify({
            root: {
              content: { uri: '/v1/3dtiles/datasets/X/files/sub.glb?session=s99' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(glbMagic, {
        status: 200,
        headers: { 'Content-Type': 'model/gltf-binary' },
      });
    };

    const jsonResp = await proxyGoogle3DTilesRequest(
      ['v1', '3dtiles', 'root.json'],
      new URLSearchParams('key=proxy'),
      'real-secret-maps-key',
      stubFetch
    );
    expect(jsonResp.status).toBe(200);
    expect(seenUrl).toContain('key=real-secret-maps-key');
    expect(seenUrl).not.toContain('key=proxy');
    expect(seenSolutionHeader).toBe('gmp_git_agentskills_v1');
    expect(jsonResp.headers.get('cache-control')).toBe('no-store');
    const parsedJson = await jsonResp.json();
    expect(parsedJson.root.content.uri).toBe(
      '/api/maps/tiles/v1/3dtiles/datasets/X/files/sub.glb?session=s99'
    );

    const binResp = await proxyGoogle3DTilesRequest(
      ['v1', '3dtiles', 'datasets', 'X', 'files', 'sub.glb'],
      new URLSearchParams('key=proxy&session=s99'),
      'real-secret-maps-key',
      stubFetch
    );
    expect(binResp.status).toBe(200);
    expect(seenUrl).toContain('session=s99');
    const outBytes = new Uint8Array(await binResp.arrayBuffer());
    expect(Array.from(outBytes)).toEqual(Array.from(glbMagic));

    // Reject path traversal
    const badResp = await proxyGoogle3DTilesRequest(
      ['v1', '..', 'secret'],
      new URLSearchParams(),
      'real-secret-maps-key',
      stubFetch
    );
    expect(badResp.status).toBe(400);
  });

  it('reports Map Tiles API availability accurately (missing key vs 403 Demo Key vs 200 OK)', async () => {
    const missing = await checkGoogle3DTilesAvailability(undefined);
    expect(missing.available).toBe(false);
    expect(missing.status).toBe(503);

    const forbidden = await checkGoogle3DTilesAvailability('demo-key', async () => {
      return new Response('Forbidden', { status: 403 });
    });
    expect(forbidden.available).toBe(false);
    expect(forbidden.status).toBe(403);

    const ok = await checkGoogle3DTilesAvailability('prod-key', async () => {
      return new Response(JSON.stringify({ root: {} }), { status: 200 });
    });
    expect(ok.available).toBe(true);
    expect(ok.status).toBe(200);
  });

  it('populates groundElevationMeters on MapsBuildingContext for 3D Tiles ReorientationPlugin', async () => {
    const stubFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('geocode.googleapis.com/v4/geocode/destinations')) {
        return new Response(
          JSON.stringify({
            destinations: [
              {
                primary: {
                  formattedAddress: '1007 N Shartel Ave, Oklahoma City, OK 73103, USA',
                  location: { latitude: 35.4785, longitude: -97.5256 },
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('elevation')) {
        return new Response(JSON.stringify({ results: [{ elevation: 368.4 }] }), {
          status: 200,
        });
      }
      return new Response('Not enabled', { status: 403 });
    };

    const ctx = await fetchGoogleMapsBuildingContext(
      '1007 N Shartel Ave Oklahoma City Ok',
      'fake-key',
      stubFetch
    );
    expect(ctx.groundElevationMeters).toBeCloseTo(368.4, 1);
  });
});
