import { NextResponse } from 'next/server';
import {
  fetchGoogleMapsBuildingContext,
  getGoogleMapsApiKey,
} from '@/lib/maps/buildingContext';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { address?: string };
    const address = (body.address || '').trim();
    if (!address) {
      return NextResponse.json(
        { error: 'Street address is required.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const apiKey = getGoogleMapsApiKey();
    const context = await fetchGoogleMapsBuildingContext(address, apiKey);

    return NextResponse.json(context, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Google Maps building lookup failed';
    const status = message.includes('GOOGLE_MAPS_API_KEY') ? 503 : 500;
    return NextResponse.json(
      { error: message },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
