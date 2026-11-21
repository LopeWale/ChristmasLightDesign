import { describe, expect, it } from 'vitest';
import {
  BULB_PRESET_SPECS,
  BulbPresetSchema,
  ToolModeSchema,
  SurfaceMaterialSchema,
  LightRunSchema,
  DesignTelemetrySchema,
  SceneMetadataSchema,
  CameraPoseSchema,
  ReconstructionJobSchema,
  CalibrationDetectionResultSchema,
  CritiqueReportSchema,
  BOMReportSchema,
  BalconySpecSchema,
  ArchitecturalBuildingSpecSchema,
  MapsBuildingContextSchema,
} from '../src/index';

describe('shared-schemas core contracts', () => {
  it('validates all 6 BulbPreset values and exposes standard watts & default spacing', () => {
    const presets = [
      'C9_LED',
      'C7_LED',
      'MINI_5MM_LED',
      'ICICLE_DROP_LED',
      'RGB_SOFFIT_PUCK',
      'PATHWAY_C9_STAKE',
    ] as const;

    for (const preset of presets) {
      expect(BulbPresetSchema.parse(preset)).toBe(preset);
      expect(BULB_PRESET_SPECS[preset].wattsPerBulb).toBeGreaterThan(0);
      expect(BULB_PRESET_SPECS[preset].defaultSpacingInches).toBeGreaterThan(0);
    }

    expect(BULB_PRESET_SPECS.C9_LED.wattsPerBulb).toBe(0.8);
    expect(BULB_PRESET_SPECS.C7_LED.wattsPerBulb).toBe(0.6);
    expect(BULB_PRESET_SPECS.MINI_5MM_LED.wattsPerBulb).toBe(0.07);
    expect(BULB_PRESET_SPECS.ICICLE_DROP_LED.wattsPerBulb).toBe(0.07);
    expect(BULB_PRESET_SPECS.RGB_SOFFIT_PUCK.wattsPerBulb).toBe(1.5);
    expect(() => BulbPresetSchema.parse('INCANDESCENT_OLD')).toThrow();
  });

  it('validates ToolMode and SurfaceMaterial enums', () => {
    expect(ToolModeSchema.parse('HELICAL_WRAP')).toBe('HELICAL_WRAP');
    expect(ToolModeSchema.parse('CALIBRATE_RULER')).toBe('CALIBRATE_RULER');
    expect(() => ToolModeSchema.parse('FREEHAND')).toThrow();

    expect(SurfaceMaterialSchema.parse('asphalt_shingle')).toBe('asphalt_shingle');
    expect(SurfaceMaterialSchema.parse('column_post')).toBe('column_post');
    expect(SurfaceMaterialSchema.parse('foliage_shrub')).toBe('foliage_shrub');
    expect(() => SurfaceMaterialSchema.parse('glass_curtain')).toThrow();
  });

  it('validates LightRun with optional helixParams and rejects malformed runs', () => {
    const validHelixRun = {
      id: 'run-col-1',
      name: 'Left Porch Column',
      toolMode: 'HELICAL_WRAP',
      bulbPreset: 'MINI_5MM_LED',
      spacingInches: 4,
      colorsHex: ['#fff4d2', '#ff2a2a'],
      pattern: 'CANDY_CANE',
      controlPoints: [
        [-1.8, 0.12, 3.65],
        [-1.8, 3.05, 3.65],
      ],
      helixParams: {
        baseCenter: [-1.8, 0.12, 3.65],
        topCenter: [-1.8, 3.05, 3.65],
        radius: 0.14,
        turns: 7,
      },
      bulbPositions: [
        [-1.64, 0.12, 3.65],
        [-1.64, 0.25, 3.68],
      ],
      surfaceMaterial: 'column_post',
    };

    expect(LightRunSchema.parse(validHelixRun).id).toBe('run-col-1');

    expect(() =>
      LightRunSchema.parse({
        ...validHelixRun,
        spacingInches: -2,
      })
    ).toThrow();

    expect(() =>
      LightRunSchema.parse({
        ...validHelixRun,
        colorsHex: [],
      })
    ).toThrow();
  });

  it('validates DesignTelemetry contract', () => {
    const telemetry = {
      feetPerSceneUnit: 3.28084,
      calibrationSource: 'AUTO_DOOR',
      runs: [
        {
          id: 'run-eave-1',
          name: 'Main Front Eave',
          toolMode: 'LINEAR_EAVE',
          surfaceMaterial: 'metal_gutter',
          lengthFeet: 32.5,
          bulbPreset: 'C9_LED',
          bulbCount: 33,
          watts: 26.4,
          maxElevationFeet: 11.8,
        },
      ],
      totals: {
        totalLengthFeet: 32.5,
        totalBulbs: 33,
        totalWatts: 26.4,
        totalAmps120V: 0.22,
        gfci15ACircuitsNeeded: 1,
        maxHeightFeet: 11.8,
        recommendedLadderFeet: 16,
        warnings: [],
      },
    };

    expect(DesignTelemetrySchema.parse(telemetry).totals.recommendedLadderFeet).toBe(16);
  });

  it('validates SceneMetadata, CameraPose, and ReconstructionJob', () => {
    const metadata = SceneMetadataSchema.parse({
      vertexCount: 1840,
      faceCount: 2420,
      boundingBox: {
        min: [-9, 0, -6],
        max: [9, 5.8, 8.5],
      },
    });
    expect(metadata.faceCount).toBe(2420);

    const cam = CameraPoseSchema.parse({
      id: 0,
      name: 'front',
      width: 1280,
      height: 720,
      intrinsics: [
        [960, 0, 640],
        [0, 960, 360],
        [0, 0, 1],
      ],
      extrinsics: [
        [1, 0, 0, 1.5],
        [0, -1, 0, 2.2],
        [0, 0, -1, 14.5],
        [0, 0, 0, 1],
      ],
    });
    expect(cam.width).toBe(1280);

    const job = ReconstructionJobSchema.parse({
      jobId: 'job-123',
      status: 'completed',
      progress: 100,
      mode: 'synthetic',
      backendUsed: 'synthetic',
      glbUrl: '/jobs/job-123/artifacts/scene.glb',
      camerasUrl: '/jobs/job-123/artifacts/cameras.json',
      referenceImageUrl: '/jobs/job-123/artifacts/reference_front.png',
      meshStats: metadata,
      error: null,
    });
    expect(job.status).toBe('completed');

    // FastAPI / Pydantic v2 serializes unset Optional fields as explicit JSON null when queued
    const queuedPydanticJob = ReconstructionJobSchema.parse({
      jobId: 'demo-queued',
      status: 'queued',
      progress: 0,
      mode: 'synthetic',
      backendUsed: null,
      glbUrl: null,
      camerasUrl: null,
      referenceImageUrl: null,
      meshStats: null,
      error: null,
    });
    expect(queuedPydanticJob.status).toBe('queued');
  });

  it('validates CalibrationDetectionResult, CritiqueReport, and BOMReport', () => {
    const cal = CalibrationDetectionResultSchema.parse({
      front_door: [505, 369, 742, 434],
      garage_door: [490, 710, 740, 895],
      zones: [
        {
          label: 'Main Gable Roof',
          surfaceMaterial: 'asphalt_shingle',
          box2d: [220, 180, 460, 690],
        },
      ],
    });
    expect(cal.front_door?.[0]).toBe(505);

    expect(() =>
      CalibrationDetectionResultSchema.parse({
        front_door: [505, 369, 1200, 434],
        garage_door: null,
        zones: [],
      })
    ).toThrow();

    const critique = CritiqueReportSchema.parse({
      overallScore: 8,
      architecturalCritique: 'Strong upper roofline definition; lower porch columns need vertical balance.',
      colorHarmonyNotes: 'Warm white C9s complement the brick facade cleanly.',
      darkZoneSuggestions: ['Right garage eave', 'Front boxwood shrubs'],
      conceptPresets: [
        {
          id: 'preset-warm-classic',
          name: 'Warm Architectural Classic',
          description: 'Warm white C9 eaves paired with 5mm warm white column wraps.',
          runMutations: [
            {
              bulbPreset: 'C9_LED',
              colorsHex: ['#ffd996'],
              pattern: 'SOLID',
              spacingInches: 12,
            },
          ],
          suggestedNewZones: ['Add 24-inch pathway stakes along front stone walkway'],
        },
        {
          id: 'preset-candy-cane',
          name: 'Candy Cane Heritage',
          description: 'Crisp red and pure white alternating gables and candy-cane columns.',
          runMutations: [
            {
              bulbPreset: 'C9_LED',
              colorsHex: ['#ff1e27', '#ffffff'],
              pattern: 'CANDY_CANE',
              spacingInches: 12,
            },
          ],
          suggestedNewZones: ['Wrap left and right porch columns in 7-turn candy cane helices'],
        },
        {
          id: 'preset-nordic-frost',
          name: 'Nordic Icicle Glow',
          description: 'Cool ice-blue and pure white icicle drops along gutters with twinkle shrubs.',
          runMutations: [
            {
              bulbPreset: 'ICICLE_DROP_LED',
              colorsHex: ['#dff3ff', '#7cc7ff'],
              pattern: 'TWINKLE',
              spacingInches: 6,
            },
          ],
          suggestedNewZones: ['Scatter mini 5mm twinkle nets over front boxwood shrubs'],
        },
      ],
    });
    expect(critique.conceptPresets).toHaveLength(3);

    const bom = BOMReportSchema.parse({
      spools: [
        {
          skuDescription: '25ft C9 Warm White Commercial LED Stringer (12" spacing, SPT-1)',
          bulbPreset: 'C9_LED',
          netLengthFeet: 32.5,
          paddedLengthFeet: 36.4,
          quantityToPurchase: 2,
          unitLengthFeet: 25,
          notes: 'Includes +12% slack/cut allowance; terminate custom cut with female vampire plug.',
        },
      ],
      mountingHardware: [
        {
          itemDescription: 'All-in-One Universal Shingle & Gutter Clips (100-pack)',
          surfaceMaterial: 'metal_gutter',
          quantity: 35,
          packCount: 1,
          attachmentMethod: 'Snap over front lip of aluminum K-style gutter every 12 inches.',
        },
      ],
      powerDistribution: [
        {
          itemDescription: '25ft SJTW 14/3 Weatherproof Outdoor Extension Cord (Black)',
          quantity: 2,
          specRating: '15A / 125V / 1875W',
          purpose: 'Primary riser feed from exterior GFCI receptacle to main eave start.',
        },
      ],
      safetyAndInstallPlan: [
        {
          stepNumber: 1,
          phase: 'Ground Prep & Bench Test',
          instruction: 'Test all C9 spools on ground and pre-attach shingle/gutter clips before climbing.',
          safetyNote: 'Set 16ft extension ladder at 4:1 base angle with 3ft extension above eave.',
        },
      ],
    });
    expect(bom.spools[0].quantityToPurchase).toBe(2);
  });

  it('validates BalconySpec, ArchitecturalBuildingSpec, MapsBuildingContext, and balcony SurfaceMaterials', () => {
    expect(SurfaceMaterialSchema.parse('balcony_railing')).toBe('balcony_railing');
    expect(SurfaceMaterialSchema.parse('balcony_soffit')).toBe('balcony_soffit');

    const b1 = BalconySpecSchema.parse({
      id: 'balcony-2f',
      floor: 2,
      wallFace: 'front',
      centerOffsetNorm: -0.18,
      widthMeters: 3.2,
      depthMeters: 1.4,
      mountStyle: 'cantilevered',
      railingType: 'metal_picket',
    });
    expect(b1.railingType).toBe('metal_picket');

    const condoSpec = ArchitecturalBuildingSpecSchema.parse({
      archetype: 'multi_story_condo',
      floors: 3,
      metersPerFloor: 3.05,
      footprintPolygonMeters: [
        [-6, -5],
        [6, -5],
        [6, 5],
        [-6, 5],
      ],
      roofStyle: 'flat_parapet',
      roofPitchDegrees: 2,
      wallColorRgb: [176, 118, 96],
      trimColorRgb: [236, 238, 242],
      roofColorRgb: [58, 62, 70],
      windowBaysPerFloor: 4,
      hasGarage: false,
      balconies: [
        b1,
        {
          id: 'balcony-3f',
          floor: 3,
          wallFace: 'front',
          centerOffsetNorm: 0.18,
          widthMeters: 3.2,
          depthMeters: 1.4,
          mountStyle: 'recessed',
          railingType: 'glass_panel',
        },
      ],
      sourceSummary: 'Google Maps footprint + Gemini 3-story condo extraction',
    });
    expect(condoSpec.floors).toBe(3);
    expect(condoSpec.balconies).toHaveLength(2);

    expect(() =>
      ArchitecturalBuildingSpecSchema.parse({ ...condoSpec, floors: 0 })
    ).toThrow();
    expect(() =>
      ArchitecturalBuildingSpecSchema.parse({ ...condoSpec, floors: 12 })
    ).toThrow();

    const mapsCtx = MapsBuildingContextSchema.parse({
      formattedAddress: '123 Harbor View Ave, Chicago, IL 60601, USA',
      location: { latitude: 41.886, longitude: -87.618 },
      footprintPolygonMeters: [
        [-6, -5],
        [6, -5],
        [6, 5],
        [-6, 5],
      ],
      streetFacingHeadingDeg: 180,
      estimatedHeightMeters: 9.4,
      estimatedFloors: 3,
      roofPitchDegrees: 1.5,
      streetViewBase64: null,
      streetViewCopyright: '© Google',
      warnings: [],
    });
    expect(mapsCtx.estimatedFloors).toBe(3);

    const archJob = ReconstructionJobSchema.parse({
      jobId: 'condo-job-1',
      status: 'completed',
      progress: 100,
      mode: 'auto',
      backendUsed: 'architectural',
      glbUrl: '/jobs/condo-job-1/artifacts/scene.glb',
      buildingSpec: condoSpec,
    });
    expect(archJob.buildingSpec?.floors).toBe(3);
  });
});
