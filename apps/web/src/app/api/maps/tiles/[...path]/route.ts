import { NextResponse, type NextRequest } from 'next/server';
import { proxyGoogle3DTilesRequest } from '@/lib/maps/tilesProxy';

export async function GET(
  request: NextRequest,
  context: { params: { path: string[] } }
): Promise<Response> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === 'your_google_maps_api_key_here') {
    return NextResponse.json(
      { error: 'GOOGLE_MAPS_API_KEY is not configured in .env' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const subPath = context.params?.path || [];
  return proxyGoogle3DTilesRequest(
    subPath,
    request.nextUrl.searchParams,
    apiKey
  );
}
