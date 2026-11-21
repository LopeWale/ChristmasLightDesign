import '@/lib/gemini/client';
import { GMP_SOLUTION_ID } from './buildingContext';

export function rewriteTilesetJsonUris(jsonText: string): string {
  return jsonText
    .replace(
      /"https:\/\/tile\.googleapis\.com\/v1\/3dtiles\//g,
      '"/api/maps/tiles/v1/3dtiles/'
    )
    .replace(/"\/v1\/3dtiles\//g, '"/api/maps/tiles/v1/3dtiles/');
}

export async function proxyGoogle3DTilesRequest(
  subPath: string[],
  incomingSearchParams: URLSearchParams,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  if (
    subPath.length === 0 ||
    subPath.some((seg) => !seg || seg === '.' || seg === '..' || seg.includes('\\'))
  ) {
    return new Response(JSON.stringify({ error: 'Invalid 3D Tiles path' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  const normalizedPath = subPath.join('/');
  const upstreamPath = normalizedPath.startsWith('v1/3dtiles/')
    ? normalizedPath
    : `v1/3dtiles/${normalizedPath}`;

  const targetUrl = new URL(`https://tile.googleapis.com/${upstreamPath}`);
  incomingSearchParams.forEach((val, key) => {
    if (key.toLowerCase() !== 'key') {
      targetUrl.searchParams.set(key, val);
    }
  });
  targetUrl.searchParams.set('key', apiKey);

  const upstreamResp = await fetchImpl(targetUrl.toString(), {
    method: 'GET',
    headers: {
      'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
    },
    cache: 'no-store',
  });

  const contentType =
    upstreamResp.headers.get('content-type') || 'application/octet-stream';

  if (!upstreamResp.ok) {
    const errBody = await upstreamResp.text();
    return new Response(errBody, {
      status: upstreamResp.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    });
  }

  const isJson =
    contentType.includes('application/json') || upstreamPath.endsWith('.json');

  if (isJson) {
    const rawText = await upstreamResp.text();
    const rewritten = rewriteTilesetJsonUris(rawText);
    return new Response(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const binBuf = await upstreamResp.arrayBuffer();
  return new Response(binBuf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
}

export async function checkGoogle3DTilesAvailability(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<{ available: boolean; status: number; reason?: string }> {
  if (!apiKey || apiKey === 'your_google_maps_api_key_here') {
    return {
      available: false,
      status: 503,
      reason: 'GOOGLE_MAPS_API_KEY is not set in server .env',
    };
  }

  try {
    const checkUrl = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(
      apiKey
    )}`;
    const resp = await fetchImpl(checkUrl, {
      method: 'GET',
      headers: {
        'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
      },
      cache: 'no-store',
    });

    if (resp.ok) {
      return { available: true, status: 200 };
    }
    return {
      available: false,
      status: resp.status,
      reason:
        resp.status === 403
          ? 'Map Tiles API is not enabled on GOOGLE_MAPS_API_KEY yet.'
          : `Map Tiles API returned HTTP ${resp.status}.`,
    };
  } catch (err) {
    return {
      available: false,
      status: 502,
      reason: err instanceof Error ? err.message : 'Unable to reach Map Tiles API',
    };
  }
}
