import { NextResponse } from 'next/server';
import { LiveScanSessionSchema } from '@lumen3d/shared-schemas';
import {
  getWorkerBaseUrl,
  NO_STORE_HEADERS,
  rewriteScanSessionUrls,
} from '@/lib/scan/scanProxy';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const { sessionId } = await context.params;
  const safeId = (sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) {
    return NextResponse.json(
      { error: 'Invalid scan sessionId' },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const upstream = await fetch(
      `${getWorkerBaseUrl()}/scan/sessions/${encodeURIComponent(safeId)}`,
      { cache: 'no-store' }
    );
    if (!upstream.ok) {
      const errText = await upstream.text();
      return NextResponse.json(
        { error: `Scan session lookup failed (${upstream.status}): ${errText}` },
        { status: upstream.status, headers: NO_STORE_HEADERS }
      );
    }

    const raw = await upstream.json();
    const parsed = rewriteScanSessionUrls(LiveScanSessionSchema.parse(raw));
    return NextResponse.json(parsed, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to poll live scan session';
    return NextResponse.json(
      { error: message },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
