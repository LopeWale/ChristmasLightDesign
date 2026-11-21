import { NextResponse } from 'next/server';
import { checkGoogle3DTilesAvailability } from '@/lib/maps/tilesProxy';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const result = await checkGoogle3DTilesAvailability(
    process.env.GOOGLE_MAPS_API_KEY
  );
  return NextResponse.json(result, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
