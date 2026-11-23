import { NextResponse } from 'next/server';
import { LiveScanSessionSchema } from '@lumen3d/shared-schemas';
import {
  fetchGoogleMapsBuildingContext,
  mapsContextToPartialOverrides,
} from '@/lib/maps/buildingContext';
import {
  generateScanQrDataUrl,
  getWorkerBaseUrl,
  NO_STORE_HEADERS,
  resolveMobileScanOrigin,
  rewriteScanSessionUrls,
  type LiveScanSessionWithQr,
} from '@/lib/scan/scanProxy';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const workerBase = getWorkerBaseUrl();

  try {
    const body = (await request.json().catch(() => ({}))) as {
      address?: string;
      targetHeightMeters?: number;
      partialOverrides?: Record<string, unknown>;
    };

    const address = typeof body.address === 'string' ? body.address.trim() : '';
    let targetHeightMeters =
      typeof body.targetHeightMeters === 'number' &&
      Number.isFinite(body.targetHeightMeters) &&
      body.targetHeightMeters > 0
        ? body.targetHeightMeters
        : undefined;
    let partialOverrides = body.partialOverrides;

    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (
      address &&
      targetHeightMeters === undefined &&
      mapsKey &&
      mapsKey !== 'your_google_maps_api_key_here'
    ) {
      try {
        const mapsCtx = await Promise.race([
          fetchGoogleMapsBuildingContext(address, mapsKey),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
        ]);
        if (mapsCtx) {
          if (mapsCtx.estimatedHeightMeters && mapsCtx.estimatedHeightMeters > 1.5) {
            targetHeightMeters = mapsCtx.estimatedHeightMeters;
          }
          if (!partialOverrides) {
            partialOverrides = mapsContextToPartialOverrides(mapsCtx);
          }
        }
      } catch {
        // Proceed cleanly without blocking live camera scan startup
      }
    }

    const upstreamResp = await fetch(`${workerBase}/scan/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: address || undefined,
        targetHeightMeters,
        partialOverrides,
      }),
      cache: 'no-store',
    });

    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text();
      return NextResponse.json(
        { error: `Scan worker error (${upstreamResp.status}): ${errText}` },
        { status: upstreamResp.status, headers: NO_STORE_HEADERS }
      );
    }

    const raw = await upstreamResp.json();
    const parsed = rewriteScanSessionUrls(LiveScanSessionSchema.parse(raw));
    const origin = resolveMobileScanOrigin(request);
    const mobileScanUrl = `${origin}/scan/${encodeURIComponent(parsed.sessionId)}`;
    const qrCodeDataUrl = await generateScanQrDataUrl(mobileScanUrl);

    const payload: LiveScanSessionWithQr = {
      ...parsed,
      mobileScanUrl,
      qrCodeDataUrl,
    };

    return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to create live scan session';
    return NextResponse.json(
      { error: message },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
