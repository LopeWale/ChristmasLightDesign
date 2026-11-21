import { z } from 'zod';

// ---------------------------------------------------------------------------
// 1. Bulb Presets & Electrical/Physical Specifications
// ---------------------------------------------------------------------------

export const BulbPresetSchema = z.enum([
  'C9_LED',
  'C7_LED',
  'MINI_5MM_LED',
  'ICICLE_DROP_LED',
  'RGB_SOFFIT_PUCK',
  'PATHWAY_C9_STAKE',
]);
export type BulbPreset = z.infer<typeof BulbPresetSchema>;

export interface BulbPresetSpec {
  id: BulbPreset;
  label: string;
  wattsPerBulb: number;
  defaultSpacingInches: number;
  bulbRadiusInches: number;
}

export const BULB_PRESET_SPECS: Record<BulbPreset, BulbPresetSpec> = {
  C9_LED: {
    id: 'C9_LED',
    label: 'C9 Faceted LED',
    wattsPerBulb: 0.8,
    defaultSpacingInches: 12,
    bulbRadiusInches: 1.25,
  },
  C7_LED: {
    id: 'C7_LED',
    label: 'C7 Classic LED',
    wattsPerBulb: 0.6,
    defaultSpacingInches: 8,
    bulbRadiusInches: 0.95,
  },
  MINI_5MM_LED: {
    id: 'MINI_5MM_LED',
    label: '5mm Wide-Angle Mini LED',
    wattsPerBulb: 0.07,
    defaultSpacingInches: 4,
    bulbRadiusInches: 0.55,
  },
  ICICLE_DROP_LED: {
    id: 'ICICLE_DROP_LED',
    label: 'Icicle Drop LED Set',
    wattsPerBulb: 0.07,
    defaultSpacingInches: 6,
    bulbRadiusInches: 0.6,
  },
  RGB_SOFFIT_PUCK: {
    id: 'RGB_SOFFIT_PUCK',
    label: 'RGB Architectural Soffit Puck',
    wattsPerBulb: 1.5,
    defaultSpacingInches: 9,
    bulbRadiusInches: 1.4,
  },
  PATHWAY_C9_STAKE: {
    id: 'PATHWAY_C9_STAKE',
    label: 'Pathway C9 Ground Stake',
    wattsPerBulb: 0.8,
    defaultSpacingInches: 24,
    bulbRadiusInches: 1.35,
  },
};

// ---------------------------------------------------------------------------
// 2. Tool Modes, Surface Materials & Light Patterns
// ---------------------------------------------------------------------------

export const ToolModeSchema = z.enum([
  'SELECT',
  'CALIBRATE_RULER',
  'LINEAR_EAVE',
  'HELICAL_WRAP',
  'SURFACE_SCATTER',
  'PATHWAY_STAKE',
]);
export type ToolMode = z.infer<typeof ToolModeSchema>;

export const SurfaceMaterialSchema = z.enum([
  'asphalt_shingle',
  'metal_gutter',
  'wood_fascia',
  'brick_masonry',
  'vinyl_siding',
  'stucco',
  'column_post',
  'balcony_railing',
  'balcony_soffit',
  'foliage_shrub',
  'ground_turf',
  'unknown',
]);
export type SurfaceMaterial = z.infer<typeof SurfaceMaterialSchema>;

export const LightPatternSchema = z.enum([
  'SOLID',
  'ALTERNATING',
  'CANDY_CANE',
  'TWINKLE',
]);
export type LightPattern = z.infer<typeof LightPatternSchema>;

export const Vec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export type Vec3 = z.infer<typeof Vec3Schema>;

// ---------------------------------------------------------------------------
// 3. LightRun
// ---------------------------------------------------------------------------

export const HelixParamsSchema = z.object({
  baseCenter: Vec3Schema,
  topCenter: Vec3Schema,
  radius: z.number().positive(),
  turns: z.number().positive(),
});
export type HelixParams = z.infer<typeof HelixParamsSchema>;

export const LightRunSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  toolMode: ToolModeSchema,
  bulbPreset: BulbPresetSchema,
  spacingInches: z.number().positive(),
  colorsHex: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(1),
  pattern: LightPatternSchema,
  controlPoints: z.array(Vec3Schema),
  helixParams: HelixParamsSchema.optional(),
  bulbPositions: z.array(Vec3Schema),
  surfaceMaterial: SurfaceMaterialSchema,
});
export type LightRun = z.infer<typeof LightRunSchema>;

// ---------------------------------------------------------------------------
// 4. DesignTelemetry (Deterministic Footage, Electrical & Ladder Math)
// ---------------------------------------------------------------------------

export const CalibrationSourceSchema = z.enum([
  'AUTO_DOOR',
  'AUTO_GARAGE',
  'MANUAL_RULER',
  'MAPS_3D_TILES',
  'DEFAULT',
]);
export type CalibrationSource = z.infer<typeof CalibrationSourceSchema>;

export const SceneSourceModeSchema = z.enum([
  'NONE',
  'MAPS_3D_TILES',
  'MESH_RECON',
]);
export type SceneSourceMode = z.infer<typeof SceneSourceModeSchema>;

export const RunTelemetrySchema = z.object({
  id: z.string(),
  name: z.string(),
  toolMode: ToolModeSchema,
  surfaceMaterial: SurfaceMaterialSchema,
  lengthFeet: z.number().nonnegative(),
  bulbPreset: BulbPresetSchema,
  bulbCount: z.number().int().nonnegative(),
  watts: z.number().nonnegative(),
  maxElevationFeet: z.number().nonnegative(),
});
export type RunTelemetry = z.infer<typeof RunTelemetrySchema>;

export const DesignTelemetryTotalsSchema = z.object({
  totalLengthFeet: z.number().nonnegative(),
  totalBulbs: z.number().int().nonnegative(),
  totalWatts: z.number().nonnegative(),
  totalAmps120V: z.number().nonnegative(),
  gfci15ACircuitsNeeded: z.number().int().positive(),
  maxHeightFeet: z.number().nonnegative(),
  recommendedLadderFeet: z.number().nonnegative(),
  warnings: z.array(z.string()),
});
export type DesignTelemetryTotals = z.infer<typeof DesignTelemetryTotalsSchema>;

export const DesignTelemetrySchema = z.object({
  feetPerSceneUnit: z.number().positive(),
  calibrationSource: CalibrationSourceSchema,
  runs: z.array(RunTelemetrySchema),
  totals: DesignTelemetryTotalsSchema,
});
export type DesignTelemetry = z.infer<typeof DesignTelemetrySchema>;

// ---------------------------------------------------------------------------
// 5. Reconstruction Service Contracts (SceneMetadata, CameraPose, Job)
// ---------------------------------------------------------------------------

export const BoundingBox3DSchema = z.object({
  min: Vec3Schema,
  max: Vec3Schema,
});
export type BoundingBox3D = z.infer<typeof BoundingBox3DSchema>;

export const SceneMetadataSchema = z.object({
  vertexCount: z.number().int().nonnegative(),
  faceCount: z.number().int().positive(),
  boundingBox: BoundingBox3DSchema,
});
export type SceneMetadata = z.infer<typeof SceneMetadataSchema>;

export const CameraPoseSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  intrinsics: z.array(z.array(z.number()).length(3)).length(3),
  extrinsics: z.array(z.array(z.number()).length(4)).length(4),
});
export type CameraPose = z.infer<typeof CameraPoseSchema>;

export const CamerasPayloadSchema = z.object({
  convention: z.string().optional(),
  cameras: z.array(CameraPoseSchema).min(1),
});
export type CamerasPayload = z.infer<typeof CamerasPayloadSchema>;

export const ReconstructionModeSchema = z.enum([
  'auto',
  'da3',
  'vggt',
  'synthetic',
]);
export type ReconstructionMode = z.infer<typeof ReconstructionModeSchema>;

export const ReconstructionJobStatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
]);
export type ReconstructionJobStatus = z.infer<typeof ReconstructionJobStatusSchema>;

export const BalconyWallFaceSchema = z.enum(['front', 'left', 'right', 'rear']);
export type BalconyWallFace = z.infer<typeof BalconyWallFaceSchema>;

export const BalconyMountStyleSchema = z.enum(['cantilevered', 'recessed']);
export type BalconyMountStyle = z.infer<typeof BalconyMountStyleSchema>;

export const BalconyRailingTypeSchema = z.enum([
  'metal_picket',
  'glass_panel',
  'solid_parapet',
]);
export type BalconyRailingType = z.infer<typeof BalconyRailingTypeSchema>;

export const BalconySpecSchema = z.object({
  id: z.string().min(1),
  floor: z.number().int().min(1).max(8),
  wallFace: BalconyWallFaceSchema,
  centerOffsetNorm: z.number().min(-0.45).max(0.45),
  widthMeters: z.number().min(0.8).max(20.0),
  depthMeters: z.number().min(0.4).max(6.0),
  mountStyle: BalconyMountStyleSchema,
  railingType: BalconyRailingTypeSchema,
});
export type BalconySpec = z.infer<typeof BalconySpecSchema>;

export const RgbTupleSchema = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);
export type RgbTuple = z.infer<typeof RgbTupleSchema>;

export const ArchitecturalBuildingSpecSchema = z.object({
  archetype: z.enum([
    'multi_story_condo',
    'townhouse',
    'single_family_gable',
    'modern_box',
  ]),
  floors: z.number().int().min(1).max(8),
  metersPerFloor: z.number().min(2.4).max(5.0).default(3.05),
  footprintPolygonMeters: z
    .array(z.tuple([z.number().finite(), z.number().finite()]))
    .min(3),
  roofStyle: z.enum(['flat_parapet', 'pitched_gable', 'hip']),
  roofPitchDegrees: z.number().min(0).max(55),
  wallColorRgb: RgbTupleSchema,
  trimColorRgb: RgbTupleSchema,
  roofColorRgb: RgbTupleSchema,
  windowBaysPerFloor: z.number().int().min(1).max(12),
  hasGarage: z.boolean(),
  balconies: z.array(BalconySpecSchema),
  sourceSummary: z.string(),
});
export type ArchitecturalBuildingSpec = z.infer<
  typeof ArchitecturalBuildingSpecSchema
>;

export const MapsBuildingContextSchema = z.object({
  formattedAddress: z.string().min(1),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  footprintPolygonMeters: z
    .array(z.tuple([z.number().finite(), z.number().finite()]))
    .min(3)
    .nullable(),
  groundElevationMeters: z
    .number()
    .finite()
    .nullish()
    .transform((v) => v ?? null),
  streetFacingHeadingDeg: z.number().finite().nullable(),
  estimatedHeightMeters: z.number().positive().nullable(),
  estimatedFloors: z.number().int().min(1).max(8).nullable(),
  roofPitchDegrees: z.number().min(0).max(55).nullable(),
  streetViewBase64: z.string().nullable(),
  streetViewMimeType: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  streetViewCopyright: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type MapsBuildingContext = z.infer<typeof MapsBuildingContextSchema>;

export const ReconstructionJobSchema = z.object({
  jobId: z.string().min(1),
  status: ReconstructionJobStatusSchema,
  progress: z.number().min(0).max(100),
  mode: ReconstructionModeSchema,
  backendUsed: z
    .enum(['vggt', 'synthetic', 'architectural', 'da3'])
    .nullish()
    .transform((v) => v ?? undefined),
  glbUrl: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
  splatUrl: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
  camerasUrl: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
  referenceImageUrl: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
  meshStats: SceneMetadataSchema.nullish().transform((v) => v ?? undefined),
  buildingSpec: ArchitecturalBuildingSpecSchema.nullish().transform(
    (v) => v ?? undefined
  ),
  error: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
});
export type ReconstructionJob = z.infer<typeof ReconstructionJobSchema>;

// ---------------------------------------------------------------------------
// 6. Gemini Spatial Calibration Contracts (Normalized 0..1000 [ymin,xmin,ymax,xmax])
// ---------------------------------------------------------------------------

export const BoundingBox2DSchema = z
  .tuple([
    z.number().min(0).max(1000),
    z.number().min(0).max(1000),
    z.number().min(0).max(1000),
    z.number().min(0).max(1000),
  ])
  .refine(([ymin, xmin, ymax, xmax]) => ymax > ymin && xmax > xmin, {
    message: 'BoundingBox2D requires ymax > ymin and xmax > xmin',
  });
export type BoundingBox2D = z.infer<typeof BoundingBox2DSchema>;

export const DetectedZoneSchema = z.object({
  label: z.string().min(1),
  surfaceMaterial: SurfaceMaterialSchema,
  box2d: BoundingBox2DSchema,
});
export type DetectedZone = z.infer<typeof DetectedZoneSchema>;

export const CalibrationDetectionResultSchema = z.object({
  front_door: BoundingBox2DSchema.nullable(),
  garage_door: BoundingBox2DSchema.nullable(),
  zones: z.array(DetectedZoneSchema),
  notes: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
});
export type CalibrationDetectionResult = z.infer<
  typeof CalibrationDetectionResultSchema
>;

// ---------------------------------------------------------------------------
// 7. Gemini Multimodal Critique & BOM Report Contracts
// ---------------------------------------------------------------------------

export const ConceptRunMutationSchema = z.object({
  runId: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
  bulbPreset: BulbPresetSchema,
  colorsHex: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(1),
  pattern: LightPatternSchema,
  spacingInches: z.number().positive(),
});
export type ConceptRunMutation = z.infer<typeof ConceptRunMutationSchema>;

export const ConceptPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  runMutations: z.array(ConceptRunMutationSchema),
  suggestedNewZones: z.array(z.string()),
});
export type ConceptPreset = z.infer<typeof ConceptPresetSchema>;

export const CritiqueReportSchema = z.object({
  overallScore: z.number().min(1).max(10),
  architecturalCritique: z.string().min(1),
  colorHarmonyNotes: z.string().min(1),
  darkZoneSuggestions: z.array(z.string()),
  conceptPresets: z.array(ConceptPresetSchema).length(3),
});
export type CritiqueReport = z.infer<typeof CritiqueReportSchema>;

export const BOMSpoolItemSchema = z.object({
  skuDescription: z.string().min(1),
  bulbPreset: BulbPresetSchema,
  netLengthFeet: z.number().nonnegative(),
  paddedLengthFeet: z.number().nonnegative(),
  quantityToPurchase: z.number().int().positive(),
  unitLengthFeet: z.number().positive(),
  notes: z.string(),
});
export type BOMSpoolItem = z.infer<typeof BOMSpoolItemSchema>;

export const BOMMountingHardwareItemSchema = z.object({
  itemDescription: z.string().min(1),
  surfaceMaterial: SurfaceMaterialSchema,
  quantity: z.number().int().positive(),
  packCount: z.number().int().positive(),
  attachmentMethod: z.string().min(1),
});
export type BOMMountingHardwareItem = z.infer<typeof BOMMountingHardwareItemSchema>;

export const BOMPowerDistributionItemSchema = z.object({
  itemDescription: z.string().min(1),
  quantity: z.number().int().positive(),
  specRating: z.string().min(1),
  purpose: z.string().min(1),
});
export type BOMPowerDistributionItem = z.infer<typeof BOMPowerDistributionItemSchema>;

export const BOMSafetyInstallStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  phase: z.string().min(1),
  instruction: z.string().min(1),
  safetyNote: z.string().min(1),
});
export type BOMSafetyInstallStep = z.infer<typeof BOMSafetyInstallStepSchema>;

export const BOMReportSchema = z.object({
  spools: z.array(BOMSpoolItemSchema),
  mountingHardware: z.array(BOMMountingHardwareItemSchema),
  powerDistribution: z.array(BOMPowerDistributionItemSchema),
  safetyAndInstallPlan: z.array(BOMSafetyInstallStepSchema),
  summaryNotes: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
});
export type BOMReport = z.infer<typeof BOMReportSchema>;

// ---------------------------------------------------------------------------
// 8. Studio Project Save/Load Contract
// ---------------------------------------------------------------------------

export const ProjectExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  feetPerSceneUnit: z.number().positive(),
  calibrationSource: CalibrationSourceSchema,
  lightingMode: z.enum(['DAY', 'DUSK', 'NIGHT']),
  runs: z.array(LightRunSchema),
});
export type ProjectExport = z.infer<typeof ProjectExportSchema>;
