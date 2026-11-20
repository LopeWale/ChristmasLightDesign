import { NextResponse } from 'next/server';
import {
  BOMReportSchema,
  BULB_PRESET_SPECS,
  DesignTelemetrySchema,
  type BOMMountingHardwareItem,
  type BOMReport,
  type BOMSpoolItem,
  type BulbPreset,
  type DesignTelemetry,
  type DetectedZone,
  type SurfaceMaterial,
} from '@lumen3d/shared-schemas';
import {
  BULB_PRESET_ENUM_VALUES,
  getGenAIClient,
  getGeminiModel,
  isGeminiMockMode,
  SURFACE_MATERIAL_ENUM_VALUES,
  Type,
  type Schema,
} from '@/lib/gemini/client';

const BOM_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    spools: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          skuDescription: { type: Type.STRING },
          bulbPreset: { type: Type.STRING, enum: BULB_PRESET_ENUM_VALUES },
          netLengthFeet: { type: Type.NUMBER },
          paddedLengthFeet: { type: Type.NUMBER },
          quantityToPurchase: { type: Type.INTEGER },
          unitLengthFeet: { type: Type.NUMBER },
          notes: { type: Type.STRING },
        },
        required: [
          'skuDescription',
          'bulbPreset',
          'netLengthFeet',
          'paddedLengthFeet',
          'quantityToPurchase',
          'unitLengthFeet',
          'notes',
        ],
      },
    },
    mountingHardware: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          itemDescription: { type: Type.STRING },
          surfaceMaterial: {
            type: Type.STRING,
            enum: SURFACE_MATERIAL_ENUM_VALUES,
          },
          quantity: { type: Type.INTEGER },
          packCount: { type: Type.INTEGER },
          attachmentMethod: { type: Type.STRING },
        },
        required: [
          'itemDescription',
          'surfaceMaterial',
          'quantity',
          'packCount',
          'attachmentMethod',
        ],
      },
    },
    powerDistribution: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          itemDescription: { type: Type.STRING },
          quantity: { type: Type.INTEGER },
          specRating: { type: Type.STRING },
          purpose: { type: Type.STRING },
        },
        required: ['itemDescription', 'quantity', 'specRating', 'purpose'],
      },
    },
    safetyAndInstallPlan: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          stepNumber: { type: Type.INTEGER },
          phase: { type: Type.STRING },
          instruction: { type: Type.STRING },
          safetyNote: { type: Type.STRING },
        },
        required: ['stepNumber', 'phase', 'instruction', 'safetyNote'],
      },
    },
    summaryNotes: { type: Type.STRING },
  },
  required: [
    'spools',
    'mountingHardware',
    'powerDistribution',
    'safetyAndInstallPlan',
  ],
};

function mapSurfaceHardwareRule(
  surface: SurfaceMaterial,
  totalClips: number
): BOMMountingHardwareItem {
  const safeClips = Math.max(10, Math.ceil(totalClips * 1.1));
  switch (surface) {
    case 'asphalt_shingle':
    case 'metal_gutter':
    case 'wood_fascia':
      return {
        itemDescription: 'All-in-One Universal Shingle & Gutter Clips (100-Pack)',
        surfaceMaterial: surface,
        quantity: safeClips,
        packCount: Math.max(1, Math.ceil(safeClips / 100)),
        attachmentMethod:
          surface === 'asphalt_shingle'
            ? 'Slide flat tab under architectural asphalt shingle edge every 12 inches.'
            : 'Snap clip hook over front K-style metal gutter lip or fascia trim every 12 inches.',
      };
    case 'brick_masonry':
    case 'stucco':
    case 'vinyl_siding':
      return {
        itemDescription: 'Outdoor Masonry Brick Clips & UV Hot-Glue Mount Tabs (50-Pack)',
        surfaceMaterial: surface,
        quantity: safeClips,
        packCount: Math.max(1, Math.ceil(safeClips / 50)),
        attachmentMethod:
          'Cinch spring brick clips onto mortar recessed edges or adhere low-temp outdoor UV glue tabs.',
      };
    case 'column_post':
      return {
        itemDescription: 'Heavy-Duty UV-Stabilized Nylon Column Zip-Ties & Padded Cinches (100-Pack)',
        surfaceMaterial: surface,
        quantity: safeClips,
        packCount: Math.max(1, Math.ceil(safeClips / 100)),
        attachmentMethod:
          'Anchor top and bottom helix collars with non-marring padded UV zip-ties so wraps never slip.',
      };
    case 'foliage_shrub':
      return {
        itemDescription: 'Green Foliage Branch & Net Locking Clips (100-Pack)',
        surfaceMaterial: surface,
        quantity: safeClips,
        packCount: Math.max(1, Math.ceil(safeClips / 100)),
        attachmentMethod:
          'Drape mini-LED strands evenly across shrub canopy and secure perimeter branches.',
      };
    case 'ground_turf':
      return {
        itemDescription: '10-Inch Reinforced Polymer C9/C7 Ground Pathway Stakes (25-Pack)',
        surfaceMaterial: surface,
        quantity: safeClips,
        packCount: Math.max(1, Math.ceil(safeClips / 25)),
        attachmentMethod:
          'Press stakes 4 inches into turf border 3 inches clear of stone walkway edge.',
      };
    default:
      return {
        itemDescription: 'Multi-Surface Exterior Holiday Light Clips (100-Pack)',
        surfaceMaterial: surface,
        quantity: safeClips,
        packCount: Math.max(1, Math.ceil(safeClips / 100)),
        attachmentMethod: 'Secure along mounting line at bulb socket intervals.',
      };
  }
}

function buildDeterministicBOMReport(
  telemetry: DesignTelemetry
): BOMReport {
  // Group net footage by BulbPreset
  const byPreset = new Map<BulbPreset, { netFeet: number; bulbs: number }>();
  for (const r of telemetry.runs) {
    const prev = byPreset.get(r.bulbPreset) || { netFeet: 0, bulbs: 0 };
    byPreset.set(r.bulbPreset, {
      netFeet: prev.netFeet + Math.max(1, r.lengthFeet),
      bulbs: prev.bulbs + r.bulbCount,
    });
  }

  const spools: BOMSpoolItem[] = [];
  for (const [preset, agg] of byPreset.entries()) {
    const spec = BULB_PRESET_SPECS[preset];
    const unitFeet =
      preset === 'MINI_5MM_LED' || preset === 'ICICLE_DROP_LED' ? 25 : 25;
    const netLengthFeet = Math.round(agg.netFeet * 100) / 100;
    const paddedLengthFeet = Math.round(netLengthFeet * 1.12 * 100) / 100;
    const quantityToPurchase = Math.max(
      1,
      Math.ceil(paddedLengthFeet / unitFeet)
    );

    const skuDesc =
      preset === 'C9_LED'
        ? '25ft Commercial C9 Faceted LED Stringer + SPT-1 Socket Wire (12" spacing)'
        : preset === 'C7_LED'
          ? '25ft Classic C7 LED Stringer Spool (8" spacing, SPT-1)'
          : preset === 'MINI_5MM_LED'
            ? '25ft 5mm Wide-Angle Conical Mini LED Commercial Strand (70-ct)'
            : preset === 'ICICLE_DROP_LED'
              ? '25ft Commercial Icicle Drop LED Set (6" drop spacing, sealed coaxial)'
              : preset === 'RGB_SOFFIT_PUCK'
                ? '25ft Architectural RGBW Soffit Track Puck Kit + Controller'
                : '25ft C9 SPT-1 Pathway Cord + Faceted C9 LED Bulbs';

    spools.push({
      skuDescription: skuDesc,
      bulbPreset: preset,
      netLengthFeet,
      paddedLengthFeet,
      quantityToPurchase,
      unitLengthFeet: unitFeet,
      notes: `Includes +12% slack/waste allowance (${agg.bulbs} bulbs @ ${spec.wattsPerBulb}W each).`,
    });
  }

  if (spools.length === 0) {
    spools.push({
      skuDescription: '25ft Commercial C9 Faceted LED Starter Spool (SPT-1)',
      bulbPreset: 'C9_LED',
      netLengthFeet: 25,
      paddedLengthFeet: 28,
      quantityToPurchase: 2,
      unitLengthFeet: 25,
      notes: 'Starter spool allowance (+12% slack).',
    });
  }

  // Group clips by SurfaceMaterial
  const bySurface = new Map<SurfaceMaterial, number>();
  for (const r of telemetry.runs) {
    const prev = bySurface.get(r.surfaceMaterial) || 0;
    const clipsForRun =
      r.toolMode === 'HELICAL_WRAP'
        ? 16
        : Math.max(4, Math.ceil(r.lengthFeet));
    bySurface.set(r.surfaceMaterial, prev + clipsForRun);
  }

  const mountingHardware: BOMMountingHardwareItem[] = [];
  for (const [surface, count] of bySurface.entries()) {
    mountingHardware.push(mapSurfaceHardwareRule(surface, count));
  }
  if (mountingHardware.length === 0) {
    mountingHardware.push(mapSurfaceHardwareRule('metal_gutter', 50));
  }

  const circuits = telemetry.totals.gfci15ACircuitsNeeded;
  const ladderFt = telemetry.totals.recommendedLadderFeet || 16;

  return {
    spools,
    mountingHardware,
    powerDistribution: [
      {
        itemDescription: '50ft Outdoor SJTW 12/3 Heavy-Duty Weatherproof Extension Cord',
        quantity: circuits * 2,
        specRating: '15A / 125V / 1875W Cold-Weather Jacket',
        purpose: `Primary home-run feeds across ${circuits} dedicated exterior 15A GFCI circuit(s).`,
      },
      {
        itemDescription: 'Weatherproof 3-Way Outdoor Piggyback Power Splitter',
        quantity: Math.max(2, Math.ceil(telemetry.runs.length / 2) + 1),
        specRating: '15A SJTW Molded Weather-Tight',
        purpose: 'Branch roof eave, column wrap, and shrub runs cleanly without daisy-chain overload.',
      },
      {
        itemDescription: 'SPT-1 Inline & End Male/Female Gilbert Vampire Plugs (12-Pack)',
        quantity: 1,
        specRating: '8A / 125V UL Listed Slide-On',
        purpose: 'Custom-length jump wires across unlit architectural gaps and dormers.',
      },
      {
        itemDescription: 'Smart Outdoor Wi-Fi Dusk-to-Dawn Dual-Outlet Timer Plug',
        quantity: circuits,
        specRating: '15A / 1800W IP65 Weatherproof',
        purpose: 'Automated astronomical sunset-to-midnight scheduling.',
      },
    ],
    safetyAndInstallPlan: [
      {
        stepNumber: 1,
        phase: 'Ground Prep & Bench Test',
        instruction:
          'Unbox all LED spools on the ground, verify illumination before climbing, and pre-snap universal clips onto C9/C7 sockets.',
        safetyNote: 'Inspect exterior GFCI outlets with TEST/RESET button before connecting loads.',
      },
      {
        stepNumber: 2,
        phase: 'Ladder Setup & Upper Roofline Runs',
        instruction: `Position a ${ladderFt} ft fiberglass extension ladder to install upper gable and gutter runs (${telemetry.totals.maxHeightFeet.toFixed(1)} ft peak elevation).`,
        safetyNote: `Maintain strict 4:1 base angle ratio with 3 ft of ladder rail extending above the ${ladderFt} ft ladder's eave contact point.`,
      },
      {
        stepNumber: 3,
        phase: 'Porch Column Helices, Shrubs & Walkway Stakes',
        instruction:
          'Anchor column helix wraps top-to-bottom with UV zip-ties, drape shrub nets evenly, and set pathway stakes along the stone walkway.',
        safetyNote: 'Route jump cords beneath walkway expansion joints or behind mulch beds to eliminate trip hazards.',
      },
      {
        stepNumber: 4,
        phase: 'NEC GFCI Load Balancing & Weatherproofing',
        instruction: `Distribute total ${telemetry.totals.totalWatts.toFixed(1)}W (${telemetry.totals.totalAmps120V.toFixed(2)}A) across ${circuits} 15A GFCI circuit(s) (well under 1,440W NEC 80% continuous limit).`,
        safetyNote: 'Elevate outdoor splitter junctions off wet turf and cap any unused female plugs.',
      },
    ],
    summaryNotes: `Engineered for ${telemetry.totals.totalLengthFeet.toFixed(1)} ft net lighted length (${telemetry.totals.totalBulbs} bulbs, ${telemetry.totals.totalWatts.toFixed(1)}W) with +12% spool slack.`,
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      telemetry: unknown;
      detectedZones?: DetectedZone[];
    };

    const telemetry = DesignTelemetrySchema.parse(body.telemetry);
    const detectedZones = Array.isArray(body.detectedZones)
      ? body.detectedZones
      : [];

    if (isGeminiMockMode()) {
      const report = BOMReportSchema.parse(buildDeterministicBOMReport(telemetry));
      return NextResponse.json(report);
    }

    const ai = getGenAIClient();
    const baseline = buildDeterministicBOMReport(telemetry);

    const promptText = [
      'Generate a complete, contractor-grade exterior holiday lighting Bill of Materials (BOMReport) JSON.',
      `Exact deterministic DesignTelemetry JSON (preserve exact net footage, +12% padded footage, ${telemetry.totals.recommendedLadderFeet} ft recommended ladder, and ${telemetry.totals.gfci15ACircuitsNeeded} GFCI circuit count): ${JSON.stringify(telemetry)}`,
      `Detected facade surface zones: ${JSON.stringify(detectedZones)}`,
      `Reference baseline calculation to refine with professional install notes: ${JSON.stringify(baseline)}`,
      'Ensure spools include +12% slack/waste footage and integer quantityToPurchase, mountingHardware matches each SurfaceMaterial (shingle/gutter clips, brick clips, UV zip-ties for columns, ground stakes), powerDistribution includes SJTW outdoor cords, splitters, vampire plugs, and smart Wi-Fi Dusk-to-Dawn timers, and safetyAndInstallPlan gives ordered phases.',
    ].join('\n\n');

    const response = await ai.models.generateContent({
      model: getGeminiModel(),
      contents: [{ text: promptText }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: BOM_RESPONSE_SCHEMA,
      },
    });

    if (!response.text) {
      throw new Error('Gemini returned an empty BOM response');
    }

    const validated = BOMReportSchema.parse(JSON.parse(response.text));
    return NextResponse.json(validated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'BOM generation failed';
    const status = message.includes('GEMINI_API_KEY') ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
