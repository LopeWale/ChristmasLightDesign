import { describe, expect, it } from 'vitest';
import {
  DesignTelemetrySchema,
  type LightRun,
} from '@lumen3d/shared-schemas';
import {
  computeDesignTelemetry,
  computeRecommendedLadderFeet,
  NEC_15A_CONTINUOUS_WATTS_LIMIT,
  MAX_SERIES_RUN_WATTS,
  MAX_SERIES_RUN_FEET,
} from '../src/lib/geometry/bomMath';
import { recomputeRunBulbPositions } from '../src/lib/geometry/splineGenerators';

function makeEaveRun(overrides: Partial<LightRun> = {}): LightRun {
  const base: Omit<LightRun, 'bulbPositions'> = {
    id: 'run-eave',
    name: 'Front Gutter Eave',
    toolMode: 'LINEAR_EAVE',
    bulbPreset: 'C9_LED',
    spacingInches: 12,
    colorsHex: ['#ffd996'],
    pattern: 'SOLID',
    controlPoints: [
      [-4.5, 3.55, 3.35],
      [4.5, 3.55, 3.35],
    ],
    surfaceMaterial: 'metal_gutter',
    ...overrides,
  };
  const scale = 3.28084;
  return {
    ...base,
    bulbPositions:
      overrides.bulbPositions ?? recomputeRunBulbPositions(base, scale),
  };
}

describe('Gate 4: Deterministic Footage, NEC Electrical & Ladder Math (bomMath)', () => {
  it('exposes standard NEC 1,440W and 210W / 200ft constants', () => {
    expect(NEC_15A_CONTINUOUS_WATTS_LIMIT).toBe(1440);
    expect(MAX_SERIES_RUN_WATTS).toBe(210);
    expect(MAX_SERIES_RUN_FEET).toBe(200);
  });

  it('scales polyline, helix, and scatter equivalent footage accurately with feetPerSceneUnit', () => {
    const eaveRun = makeEaveRun(); // 9.0 scene units wide
    const helixParams = {
      baseCenter: [-1.85, 0.14, 3.68] as [number, number, number],
      topCenter: [-1.85, 3.05, 3.68] as [number, number, number],
      radius: 0.14,
      turns: 5,
    };
    const helixRun: LightRun = {
      id: 'run-helix',
      name: 'Left Column Helix',
      toolMode: 'HELICAL_WRAP',
      bulbPreset: 'MINI_5MM_LED',
      spacingInches: 4,
      colorsHex: ['#ffd996'],
      pattern: 'SOLID',
      controlPoints: [helixParams.baseCenter, helixParams.topCenter],
      helixParams,
      bulbPositions: recomputeRunBulbPositions(
        {
          id: 'run-helix',
          name: 'Left Column Helix',
          toolMode: 'HELICAL_WRAP',
          bulbPreset: 'MINI_5MM_LED',
          spacingInches: 4,
          colorsHex: ['#ffd996'],
          pattern: 'SOLID',
          controlPoints: [helixParams.baseCenter, helixParams.topCenter],
          helixParams,
          surfaceMaterial: 'column_post',
        },
        3.28084
      ),
      surfaceMaterial: 'column_post',
    };

    const scatterRun: LightRun = {
      id: 'run-scatter',
      name: 'Left Boxwood Net',
      toolMode: 'SURFACE_SCATTER',
      bulbPreset: 'MINI_5MM_LED',
      spacingInches: 6, // 0.5 ft per bulb equivalent
      colorsHex: ['#ffffff'],
      pattern: 'TWINKLE',
      controlPoints: [[-3.1, 0.6, 3.9]],
      bulbPositions: Array.from({ length: 40 }, (_, i) => [
        -3.1 + i * 0.01,
        0.5,
        3.9,
      ]),
      surfaceMaterial: 'foliage_shrub',
    };

    const telemetry = computeDesignTelemetry({
      runs: [eaveRun, helixRun, scatterRun],
      feetPerSceneUnit: 3.28084,
      calibrationSource: 'AUTO_DOOR',
      groundMinY: 0.0,
    });

    // Validate against strict Zod contract
    expect(() => DesignTelemetrySchema.parse(telemetry)).not.toThrow();

    // 9.0 m * 3.28084 ft/m = 29.52756 ft -> 30 bulbs at 12" spacing -> 24.0W
    expect(telemetry.runs[0].lengthFeet).toBeCloseTo(29.53, 1);
    expect(telemetry.runs[0].bulbCount).toBe(30);
    expect(telemetry.runs[0].watts).toBeCloseTo(24.0, 2);

    // Scatter: 40 bulbs * 0.5 ft = 20.0 ft equivalent, 40 * 0.07W = 2.8W
    expect(telemetry.runs[2].lengthFeet).toBeCloseTo(20.0, 2);
    expect(telemetry.runs[2].watts).toBeCloseTo(2.8, 2);
  });

  it('rolls over NEC 15A/80% (1,440W) continuous GFCI circuit count accurately', () => {
    // 1800 bulbs of C9_LED (0.8W) = exact 1440.0W -> 1 circuit
    const exact1440Run = makeEaveRun({
      id: 'r1',
      controlPoints: [
        [0, 3, 0],
        [10, 3, 0],
      ],
      bulbPositions: Array.from({ length: 1800 }, (_, i) => [i * 0.01, 3, 0]),
    });

    const t1 = computeDesignTelemetry({
      runs: [exact1440Run],
      feetPerSceneUnit: 1.0,
      calibrationSource: 'MANUAL_RULER',
    });
    expect(t1.totals.totalWatts).toBeCloseTo(1440.0, 2);
    expect(t1.totals.totalAmps120V).toBeCloseTo(12.0, 3);
    expect(t1.totals.gfci15ACircuitsNeeded).toBe(1);

    // Adding 2 more C9 bulbs -> 1441.6W -> 2 circuits needed
    const over1440Run = makeEaveRun({
      id: 'r2',
      bulbPositions: Array.from({ length: 1802 }, (_, i) => [i * 0.01, 3, 0]),
    });
    const t2 = computeDesignTelemetry({
      runs: [over1440Run],
      feetPerSceneUnit: 1.0,
      calibrationSource: 'MANUAL_RULER',
    });
    expect(t2.totals.gfci15ACircuitsNeeded).toBe(2);
    expect(t2.totals.warnings.some((w) => w.includes('1,440W'))).toBe(true);
  });

  it('emits series run warnings when any single run exceeds 210W or 200 ft', () => {
    // 150 RGB_SOFFIT_PUCK bulbs * 1.5W = 225W (> 210W)
    const highWattRun = makeEaveRun({
      id: 'run-puck-heavy',
      name: 'Perimeter Soffit Pucks',
      bulbPreset: 'RGB_SOFFIT_PUCK',
      controlPoints: [
        [0, 3, 0],
        [110, 3, 0],
      ],
      bulbPositions: Array.from({ length: 150 }, (_, i) => [i, 3, 0]),
    });

    // 215 ft continuous mini LED run (> 200 ft, only 15W)
    const overLengthRun = makeEaveRun({
      id: 'run-long-mini',
      name: 'Mega Perimeter Mini Strand',
      bulbPreset: 'MINI_5MM_LED',
      controlPoints: [
        [0, 3, 0],
        [215, 3, 0],
      ],
      bulbPositions: Array.from({ length: 200 }, (_, i) => [i, 3, 0]),
    });

    const telemetry = computeDesignTelemetry({
      runs: [highWattRun, overLengthRun],
      feetPerSceneUnit: 1.0,
      calibrationSource: 'MANUAL_RULER',
    });

    expect(
      telemetry.totals.warnings.some(
        (w) => w.includes('Perimeter Soffit Pucks') && w.includes('210W')
      )
    ).toBe(true);
    expect(
      telemetry.totals.warnings.some(
        (w) => w.includes('Mega Perimeter Mini Strand') && w.includes('200 ft')
      )
    ).toBe(true);
  });

  it('computes 4:1 ladder angle + 3ft extension sizing relative to groundMinY', () => {
    expect(computeRecommendedLadderFeet(0)).toBe(0);
    // 11.8 ft eave: (11.8 * 1.03 + 3) / 4 = 15.154 / 4 = 3.7885 -> ceil 4 * 4 = 16 ft
    expect(computeRecommendedLadderFeet(11.8)).toBe(16);
    // 13.0 ft eave: (13.0 * 1.03 + 3) / 4 = 16.39 / 4 = 4.0975 -> ceil 5 * 4 = 20 ft
    expect(computeRecommendedLadderFeet(13.0)).toBe(20);
    // 18.8 ft gable peak: (18.8 * 1.03 + 3) / 4 = 22.364 / 4 = 5.591 -> ceil 6 * 4 = 24 ft
    expect(computeRecommendedLadderFeet(18.8)).toBe(24);

    // Verify groundMinY subtraction: bulb at y = 5.0 with groundMinY = 1.0 and scale = 3.0 -> 12.0 ft elevation -> 16 ft ladder
    const elevatedRun = makeEaveRun({
      controlPoints: [
        [0, 5.0, 0],
        [4, 5.0, 0],
      ],
      bulbPositions: [
        [0, 5.0, 0],
        [4, 5.0, 0],
      ],
    });
    const t = computeDesignTelemetry({
      runs: [elevatedRun],
      feetPerSceneUnit: 3.0,
      calibrationSource: 'MANUAL_RULER',
      groundMinY: 1.0,
    });
    expect(t.totals.maxHeightFeet).toBeCloseTo(12.0, 4);
    expect(t.totals.recommendedLadderFeet).toBe(16);
  });

  it('uses walk-out deck safety math for balcony_railing (0 ft) and balcony_soffit (6 ft) while warning on >40 ft exterior roofs', () => {
    // 3rd-floor balcony railing at y = 7.2m (~23.6 ft above ground) -> installed from inside balcony deck (0 ft ladder)
    const railingRun = makeEaveRun({
      id: 'run-3f-rail',
      name: '3F Balcony Railing',
      surfaceMaterial: 'balcony_railing',
      controlPoints: [
        [-2, 7.2, 5.8],
        [2, 7.2, 5.8],
      ],
      bulbPositions: [
        [-2, 7.2, 5.8],
        [0, 7.2, 5.8],
        [2, 7.2, 5.8],
      ],
    });

    const tRail = computeDesignTelemetry({
      runs: [railingRun],
      feetPerSceneUnit: 3.28084,
      calibrationSource: 'AUTO_DOOR',
    });
    expect(tRail.totals.maxHeightFeet).toBeGreaterThan(20);
    expect(tRail.totals.recommendedLadderFeet).toBe(0);

    // Adding a 3rd-floor balcony soffit run -> requires only a 6 ft step-ladder on the balcony deck
    const soffitRun = makeEaveRun({
      id: 'run-3f-soffit',
      name: '3F Balcony Ceiling Soffit',
      surfaceMaterial: 'balcony_soffit',
      bulbPreset: 'RGB_SOFFIT_PUCK',
      controlPoints: [
        [-2, 9.1, 5.4],
        [2, 9.1, 5.4],
      ],
      bulbPositions: [
        [-2, 9.1, 5.4],
        [2, 9.1, 5.4],
      ],
    });

    const tSoffit = computeDesignTelemetry({
      runs: [railingRun, soffitRun],
      feetPerSceneUnit: 3.28084,
      calibrationSource: 'AUTO_DOOR',
    });
    expect(tSoffit.totals.recommendedLadderFeet).toBe(6);

    // Adding a 5-story exterior roof parapet run (y = 14.5m ≈ 47.6 ft -> > 40 ft max residential ladder)
    const highRoofRun = makeEaveRun({
      id: 'run-5f-roof',
      name: '5F Exterior Parapet',
      surfaceMaterial: 'asphalt_shingle',
      controlPoints: [
        [-4, 14.5, 4.8],
        [4, 14.5, 4.8],
      ],
      bulbPositions: [
        [-4, 14.5, 4.8],
        [4, 14.5, 4.8],
      ],
    });

    const tHighRoof = computeDesignTelemetry({
      runs: [railingRun, highRoofRun],
      feetPerSceneUnit: 3.28084,
      calibrationSource: 'AUTO_DOOR',
    });
    expect(tHighRoof.totals.recommendedLadderFeet).toBeGreaterThan(40);
    expect(
      tHighRoof.totals.warnings.some((w) => w.includes('40 ft'))
    ).toBe(true);
  });
});
