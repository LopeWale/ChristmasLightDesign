import '@/lib/gemini/client'; // ensures root .env is preloaded server-side
import {
  MapsBuildingContextSchema,
  type MapsBuildingContext,
} from '@lumen3d/shared-schemas';

export const GMP_SOLUTION_ID = 'gmp_git_agentskills_v1';

export function getGoogleMapsApiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || key === 'your_google_maps_api_key_here') {
    throw new Error(
      'GOOGLE_MAPS_API_KEY is not set in server environment (.env)'
    );
  }
  return key;
}

function computeCompassBearingDeg(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const phi1 = (fromLat * Math.PI) / 180;
  const phi2 = (toLat * Math.PI) / 180;
  const dLambda = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return deg;
}

/**
 * Convert a GeoJSON `[lng, lat][]` building outline ring into centered local metric `[x, z]`
 * coordinates (in meters) rotated so the street-facing direction (`streetBearingDeg`, compass
 * bearing from building centroid toward street) points along `+Z`.
 */
export function latLngRingToLocalMeters(
  coords: Array<[number, number]>,
  streetBearingDeg?: number | null
): Array<[number, number]> {
  if (coords.length < 3) return [];

  let ring = [...coords];
  if (
    ring.length >= 4 &&
    Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) <
      1e-7
  ) {
    ring = ring.slice(0, -1);
  }
  if (ring.length < 3) return [];

  const meanLng = ring.reduce((acc, p) => acc + p[0], 0) / ring.length;
  const meanLat = ring.reduce((acc, p) => acc + p[1], 0) / ring.length;
  const latRad = (meanLat * Math.PI) / 180.0;

  const metersPerDegLat =
    111132.92 -
    559.82 * Math.cos(2 * latRad) +
    1.175 * Math.cos(4 * latRad);
  const metersPerDegLng =
    111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);

  const theta = (((streetBearingDeg ?? 180.0) % 360) * Math.PI) / 180.0;
  // Street-outward unit vector in (East, North) = (sin(theta), cos(theta)) -> maps to +Z
  // Viewer-right unit vector in (East, North) = (-cos(theta), sin(theta)) -> maps to +X
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);

  const rawXZ: Array<[number, number]> = ring.map(([lng, lat]) => {
    const eastM = (lng - meanLng) * metersPerDegLng;
    const northM = (lat - meanLat) * metersPerDegLat;
    const x = -cosT * eastM + sinT * northM;
    const z = sinT * eastM + cosT * northM;
    return [x, z];
  });

  const xs = rawXZ.map((p) => p[0]);
  const zs = rawXZ.map((p) => p[1]);
  const cx = 0.5 * (Math.min(...xs) + Math.max(...xs));
  const cz = 0.5 * (Math.min(...zs) + Math.max(...zs));

  return rawXZ.map(([x, z]) => [
    Math.round((x - cx) * 1000) / 1000,
    Math.round((z - cz) * 1000) / 1000,
  ]);
}

function extractFirstPolygonRing(
  displayPolygon: unknown
): Array<[number, number]> | null {
  if (!displayPolygon || typeof displayPolygon !== 'object') return null;
  const poly = displayPolygon as {
    type?: string;
    coordinates?: unknown;
  };
  if (poly.type === 'Polygon' && Array.isArray(poly.coordinates)) {
    const outer = poly.coordinates[0];
    if (Array.isArray(outer) && outer.length >= 3) {
      return outer.map((pt: number[]) => [Number(pt[0]), Number(pt[1])]);
    }
  }
  if (poly.type === 'MultiPolygon' && Array.isArray(poly.coordinates)) {
    const firstPoly = poly.coordinates[0];
    if (Array.isArray(firstPoly) && Array.isArray(firstPoly[0]) && firstPoly[0].length >= 3) {
      return firstPoly[0].map((pt: number[]) => [Number(pt[0]), Number(pt[1])]);
    }
  }
  return null;
}

export async function fetchGoogleMapsBuildingContext(
  address: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<MapsBuildingContext> {
  const warnings: string[] = [];
  const commonHeaders = {
    'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
  };

  // 1. Geocoding API v4 `destinations` for coordinates + building outline `displayPolygon`
  let formattedAddress = address.trim();
  let latitude: number | null = null;
  let longitude: number | null = null;
  let rawPolygonRing: Array<[number, number]> | null = null;

  const geoV4Resp = await fetchImpl(
    'https://geocode.googleapis.com/v4/geocode/destinations',
    {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'destinations.primary.place,destinations.primary.formattedAddress,destinations.primary.location,destinations.primary.structureType,destinations.primary.displayPolygon,destinations.containingPlaces.displayPolygon',
      },
      body: JSON.stringify({
        addressQuery: { addressQuery: formattedAddress },
      }),
      cache: 'no-store',
    }
  );

  if (geoV4Resp.ok) {
    const v4Data = (await geoV4Resp.json()) as {
      destinations?: Array<{
        primary?: {
          formattedAddress?: string;
          location?: { latitude?: number; longitude?: number };
          displayPolygon?: unknown;
        };
        containingPlaces?: Array<{ displayPolygon?: unknown }>;
      }>;
    };
    const dest = v4Data.destinations?.[0];
    if (dest?.primary) {
      if (dest.primary.formattedAddress) {
        formattedAddress = dest.primary.formattedAddress;
      }
      if (
        typeof dest.primary.location?.latitude === 'number' &&
        typeof dest.primary.location?.longitude === 'number'
      ) {
        latitude = dest.primary.location.latitude;
        longitude = dest.primary.location.longitude;
      }
      rawPolygonRing = extractFirstPolygonRing(dest.primary.displayPolygon);
      if (!rawPolygonRing && Array.isArray(dest.containingPlaces)) {
        for (const cp of dest.containingPlaces) {
          rawPolygonRing = extractFirstPolygonRing(cp.displayPolygon);
          if (rawPolygonRing) break;
        }
      }
    }
  } else {
    // Fallback to standard Geocoding REST endpoint if v4 is not enabled on key
    const fallbackUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      formattedAddress
    )}&extra_computations=BUILDING_AND_ENTRANCES&key=${encodeURIComponent(apiKey)}`;
    const fbResp = await fetchImpl(fallbackUrl, {
      headers: commonHeaders,
      cache: 'no-store',
    });
    if (fbResp.ok) {
      const fbJson = (await fbResp.json()) as {
        status?: string;
        results?: Array<{
          formatted_address?: string;
          geometry?: { location?: { lat?: number; lng?: number } };
        }>;
        buildings?: Array<{
          building_outlines?: Array<{ display_polygon?: unknown }>;
        }>;
      };
      const first = fbJson.results?.[0];
      if (first?.formatted_address) formattedAddress = first.formatted_address;
      if (
        typeof first?.geometry?.location?.lat === 'number' &&
        typeof first?.geometry?.location?.lng === 'number'
      ) {
        latitude = first.geometry.location.lat;
        longitude = first.geometry.location.lng;
      }
      const outline = fbJson.buildings?.[0]?.building_outlines?.[0]?.display_polygon;
      rawPolygonRing = extractFirstPolygonRing(outline);
    }
  }

  if (latitude === null || longitude === null) {
    throw new Error(`Unable to geocode address: "${address}"`);
  }

  // 2. Street View Static Metadata + Facade Reference Image
  let streetBearingDeg: number | null = null;
  let streetViewBase64: string | null = null;
  let streetViewMimeType: string | null = null;
  let streetViewCopyright: string | null = null;

  try {
    const svMetaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${latitude},${longitude}&radius=65&source=outdoor&key=${encodeURIComponent(
      apiKey
    )}`;
    const svMetaResp = await fetchImpl(svMetaUrl, {
      headers: commonHeaders,
      cache: 'no-store',
    });
    if (svMetaResp.ok) {
      const svMeta = (await svMetaResp.json()) as {
        status?: string;
        copyright?: string;
        location?: { lat?: number; lng?: number };
      };
      if (
        svMeta.status === 'OK' &&
        typeof svMeta.location?.lat === 'number' &&
        typeof svMeta.location?.lng === 'number'
      ) {
        streetViewCopyright = svMeta.copyright || '© Google';
        streetBearingDeg = computeCompassBearingDeg(
          latitude,
          longitude,
          svMeta.location.lat,
          svMeta.location.lng
        );
        const lookAtBuildingHeading = (streetBearingDeg + 180) % 360;
        const svImgUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${svMeta.location.lat},${svMeta.location.lng}&heading=${lookAtBuildingHeading.toFixed(
          1
        )}&pitch=12&fov=75&source=outdoor&key=${encodeURIComponent(apiKey)}`;
        const svImgResp = await fetchImpl(svImgUrl, {
          headers: commonHeaders,
          cache: 'no-store',
        });
        if (svImgResp.ok) {
          streetViewMimeType =
            svImgResp.headers.get('content-type')?.split(';')[0]?.trim() ||
            'image/jpeg';
          const buf = Buffer.from(await svImgResp.arrayBuffer());
          streetViewBase64 = buf.toString('base64');
        }
      }
    }
  } catch {
    warnings.push('Street View imagery unavailable for this coordinate.');
  }

  const footprintPolygonMeters = rawPolygonRing
    ? latLngRingToLocalMeters(rawPolygonRing, streetBearingDeg)
    : null;

  // 3. Elevation + Solar API `buildingInsights:findClosest` for metric roof height & pitch
  let groundElevationM: number | null = null;
  let estimatedHeightMeters: number | null = null;
  let estimatedFloors: number | null = null;
  let roofPitchDegrees: number | null = null;

  try {
    const elevUrl = `https://maps.googleapis.com/maps/api/elevation/json?locations=${latitude},${longitude}&key=${encodeURIComponent(
      apiKey
    )}`;
    const solarUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${latitude}&location.longitude=${longitude}&requiredQuality=BASE&key=${encodeURIComponent(
      apiKey
    )}`;

    const [elevResp, solarResp] = await Promise.all([
      fetchImpl(elevUrl, { headers: commonHeaders, cache: 'no-store' }),
      fetchImpl(solarUrl, { headers: commonHeaders, cache: 'no-store' }),
    ]);

    if (elevResp.ok) {
      const elevData = (await elevResp.json()) as {
        results?: Array<{ elevation?: number }>;
      };
      if (typeof elevData.results?.[0]?.elevation === 'number') {
        groundElevationM = Math.round(elevData.results[0].elevation * 100) / 100;
      }
    }

    if (solarResp.ok) {
      const solarData = (await solarResp.json()) as {
        solarPotential?: {
          roofSegmentStats?: Array<{
            pitchDegrees?: number;
            planeHeightAtCenterMeters?: number;
          }>;
        };
      };
      const segments = solarData.solarPotential?.roofSegmentStats || [];
      if (segments.length > 0) {
        const pitches = segments
          .map((s) => s.pitchDegrees)
          .filter((v): v is number => typeof v === 'number');
        if (pitches.length > 0) {
          const avgPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;
          roofPitchDegrees = Math.max(0, Math.min(55, Math.round(avgPitch * 10) / 10));
        }

        const planeHeights = segments
          .map((s) => s.planeHeightAtCenterMeters)
          .filter((v): v is number => typeof v === 'number');
        if (planeHeights.length > 0 && groundElevationM !== null) {
          const maxPlaneM = Math.max(...planeHeights);
          const relHeight = maxPlaneM - groundElevationM;
          if (relHeight >= 2.4 && relHeight <= 60.0) {
            estimatedHeightMeters = Math.round(relHeight * 100) / 100;
            estimatedFloors = Math.max(
              1,
              Math.min(8, Math.round(relHeight / 3.1))
            );
          }
        }
      }
    } else {
      warnings.push(
        `Solar API buildingInsights unavailable (HTTP ${solarResp.status}); using photo/CV story height.`
      );
    }
  } catch {
    warnings.push('Solar/Elevation roof insights skipped; using photo/CV story height.');
  }

  return MapsBuildingContextSchema.parse({
    formattedAddress,
    location: { latitude, longitude },
    footprintPolygonMeters:
      footprintPolygonMeters && footprintPolygonMeters.length >= 3
        ? footprintPolygonMeters
        : null,
    groundElevationMeters: groundElevationM,
    streetFacingHeadingDeg:
      streetBearingDeg !== null ? Math.round(streetBearingDeg * 10) / 10 : null,
    estimatedHeightMeters,
    estimatedFloors,
    roofPitchDegrees,
    streetViewBase64,
    streetViewMimeType,
    streetViewCopyright,
    warnings,
  });
}

export function mapsContextToPartialOverrides(
  mapsCtx: MapsBuildingContext
): Record<string, unknown> {
  const partial: Record<string, unknown> = {};
  if (mapsCtx.footprintPolygonMeters) {
    partial.footprintPolygonMeters = mapsCtx.footprintPolygonMeters;
  }
  if (mapsCtx.estimatedFloors !== null) {
    partial.floors = mapsCtx.estimatedFloors;
  }
  if (mapsCtx.roofPitchDegrees !== null) {
    partial.roofPitchDegrees = mapsCtx.roofPitchDegrees;
    partial.roofStyle =
      mapsCtx.roofPitchDegrees < 6 ? 'flat_parapet' : 'pitched_gable';
  }
  partial.sourceSummary = `Google Maps (${mapsCtx.formattedAddress}) + OpenCV facade extraction`;
  return partial;
}
