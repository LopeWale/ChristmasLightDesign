import {
  BULB_PRESET_SPECS,
  type CalibrationSource,
  type DesignTelemetry,
  type LightRun,
  type RunTelemetry,
} from '@lumen3d/shared-schemas';
import {
  computeHelixArcLengthSceneUnits,
  computePolylineArcLengthSceneUnits,
} from './splineGenerators';

export const NEC_15A_CONTINUOUS_WATTS_LIMIT = 1440;
export const MAX_SERIES_RUN_WATTS = 210;
export const MAX_SERIES_RUN_FEET = 200;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function computeRunLengthFeet(
  run: LightRun,
  feetPerSceneUnit: number
): number {
  const safeScale = Math.max(1e-4, feetPerSceneUnit);

  if (run.toolMode === 'SURFACE_SCATTER') {
    return run.bulbPositions.length * (run.spacingInches / 12.0);
  }

  if (run.toolMode === 'HELICAL_WRAP' && run.helixParams) {
    return computeHelixArcLengthSceneUnits(run.helixParams) * safeScale;
  }

  return computePolylineArcLengthSceneUnits(run.controlPoints) * safeScale;
}

export function computeRunMaxElevationFeet(
  run: LightRun,
  feetPerSceneUnit: number,
  groundMinY: number = 0
): number {
  let maxY = -Infinity;
  for (const pt of run.bulbPositions) {
    if (pt[1] > maxY) maxY = pt[1];
  }
  for (const pt of run.controlPoints) {
    if (pt[1] > maxY) maxY = pt[1];
  }
  if (!Number.isFinite(maxY)) return 0;
  return Math.max(0, (maxY - groundMinY) * Math.max(1e-4, feetPerSceneUnit));
}

/**
 * OSHA / ANSI 4:1 ladder setup angle ratio (~1.03 hypotenuse factor)
 * plus 3-foot extension above roof/eave contact point, rounded up to standard 4ft ladder increments.
 */
export function computeRecommendedLadderFeet(maxElevationFeet: number): number {
  if (!Number.isFinite(maxElevationFeet) || maxElevationFeet <= 0) {
    return 0;
  }
  return Math.ceil((maxElevationFeet * 1.03 + 3.0) / 4.0) * 4;
}

export function computeDesignTelemetry(params: {
  runs: LightRun[];
  feetPerSceneUnit: number;
  calibrationSource: CalibrationSource;
  groundMinY?: number;
}): DesignTelemetry {
  const {
    runs,
    feetPerSceneUnit,
    calibrationSource,
    groundMinY = 0,
  } = params;

  const warnings: string[] = [];
  const runTelemetries: RunTelemetry[] = [];

  let totalLengthFeet = 0;
  let totalBulbs = 0;
  let totalWatts = 0;
  let maxHeightFeet = 0;
  let maxExteriorLadderHeightFeet = 0;
  let hasBalconySoffit = false;

  for (const run of runs) {
    const spec = BULB_PRESET_SPECS[run.bulbPreset];
    const bulbCount = run.bulbPositions.length;
    const rawLengthFeet = computeRunLengthFeet(run, feetPerSceneUnit);
    const rawWatts = bulbCount * spec.wattsPerBulb;
    const rawMaxElev = computeRunMaxElevationFeet(
      run,
      feetPerSceneUnit,
      groundMinY
    );

    const lengthFeet = round2(rawLengthFeet);
    const watts = round2(rawWatts);
    const maxElevationFeet = round2(rawMaxElev);

    runTelemetries.push({
      id: run.id,
      name: run.name,
      toolMode: run.toolMode,
      surfaceMaterial: run.surfaceMaterial,
      lengthFeet,
      bulbPreset: run.bulbPreset,
      bulbCount,
      watts,
      maxElevationFeet,
    });

    totalLengthFeet += rawLengthFeet;
    totalBulbs += bulbCount;
    totalWatts += rawWatts;
    if (rawMaxElev > maxHeightFeet) {
      maxHeightFeet = rawMaxElev;
    }

    if (run.surfaceMaterial === 'balcony_soffit') {
      hasBalconySoffit = true;
    } else if (
      run.surfaceMaterial !== 'balcony_railing' &&
      rawMaxElev > maxExteriorLadderHeightFeet
    ) {
      maxExteriorLadderHeightFeet = rawMaxElev;
    }

    if (rawWatts > MAX_SERIES_RUN_WATTS) {
      warnings.push(
        `Run "${run.name}" draws ${watts}W, exceeding the ${MAX_SERIES_RUN_WATTS}W end-to-end series strand limit. Split power injection.`
      );
    }
    if (rawLengthFeet > MAX_SERIES_RUN_FEET) {
      warnings.push(
        `Run "${run.name}" spans ${lengthFeet} ft, exceeding the ${MAX_SERIES_RUN_FEET} ft continuous series run limit. Add a separate home-run feed.`
      );
    }
  }

  const roundedTotalWatts = round2(totalWatts);
  const totalAmps120V = round3(totalWatts / 120.0);
  const gfci15ACircuitsNeeded = Math.max(
    1,
    Math.ceil(roundedTotalWatts / NEC_15A_CONTINUOUS_WATTS_LIMIT)
  );

  if (roundedTotalWatts > NEC_15A_CONTINUOUS_WATTS_LIMIT) {
    warnings.push(
      `Total load (${roundedTotalWatts}W / ${totalAmps120V.toFixed(2)}A) exceeds the 1,440W NEC 80% continuous rating of a single 15A circuit; balance across ${gfci15ACircuitsNeeded} GFCI circuits.`
    );
  }

  const roundedMaxHeight = round2(maxHeightFeet);
  const exteriorLadderFeet = computeRecommendedLadderFeet(
    maxExteriorLadderHeightFeet
  );
  const balconyStepLadderFeet = hasBalconySoffit ? 6 : 0;
  const recommendedLadderFeet = Math.max(
    exteriorLadderFeet,
    balconyStepLadderFeet
  );

  if (exteriorLadderFeet > 40) {
    warnings.push(
      `Exterior run elevation (${round2(maxExteriorLadderHeightFeet)} ft) requires > 40 ft residential ladder reach; use certified boom-lift or rope-access installers.`
    );
  }

  return {
    feetPerSceneUnit,
    calibrationSource,
    runs: runTelemetries,
    totals: {
      totalLengthFeet: round2(totalLengthFeet),
      totalBulbs,
      totalWatts: roundedTotalWatts,
      totalAmps120V,
      gfci15ACircuitsNeeded,
      maxHeightFeet: roundedMaxHeight,
      recommendedLadderFeet,
      warnings,
    },
  };
}
