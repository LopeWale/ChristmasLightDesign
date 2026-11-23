import { NextResponse } from 'next/server';
import { LiveScanSessionSchema } from '@lumen3d/shared-schemas';
import {
  getWorkerBaseUrl,
  NO_STORE_HEADERS,
  rewriteScanSessionUrls,
} from '@/lib/scan/scanProxy';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
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
    const incoming = await request.formData();
    const rawFile = incoming.get('file');
    if (
      !rawFile ||
      typeof rawFile !== 'object' ||
      !('arrayBuffer' in rawFile)
    ) {
      return NextResponse.json(
        { error: 'Missing required multipart image field: file' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const sector = String(incoming.get('sector') || 'auto').trim();
    const yawDeg = String(
      incoming.get('yawDeg') ?? incoming.get('yaw_deg') ?? ''
    ).trim();

    const outForm = new FormData();
    const fileBlob = rawFile as File;
    outForm.append('file', fileBlob, fileBlob.name || 'scan_frame.jpg');
    outForm.append('sector', sector);
    if (yawDeg) {
      outForm.append('yaw_deg', yawDeg);
    }

    const upstream = await fetch(
      `${getWorkerBaseUrl()}/scan/sessions/${encodeURIComponent(safeId)}/frames`,
      {
        method: 'POST',
        body: outForm,
        cache: 'no-store',
      }
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      return NextResponse.json(
        { error: `Scan frame upload failed (${upstream.status}): ${errText}` },
        { status: upstream.status, headers: NO_STORE_HEADERS }
      );
    }

    const raw = await upstream.json();
    const parsed = rewriteScanSessionUrls(LiveScanSessionSchema.parse(raw));
    return NextResponse.json(parsed, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to upload live scan frame';
    return NextResponse.json(
      { error: message },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }
}
