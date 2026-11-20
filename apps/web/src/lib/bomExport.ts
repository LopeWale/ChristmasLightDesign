import type { BOMReport, DesignTelemetry } from '@lumen3d/shared-schemas';

function csvEscape(val: string | number): string {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatBOMAsCsv(
  bom: BOMReport,
  telemetry: DesignTelemetry
): string {
  const rows: Array<Array<string | number>> = [
    [
      'Category',
      'Item / SKU',
      'Quantity',
      'Unit / Spec',
      'Net Footage (ft)',
      'Padded +12% Footage (ft)',
      'Notes / Surface Method',
    ],
  ];

  for (const spool of bom.spools) {
    rows.push([
      'Light Spools',
      spool.skuDescription,
      spool.quantityToPurchase,
      `${spool.unitLengthFeet} ft spool (${spool.bulbPreset})`,
      spool.netLengthFeet.toFixed(1),
      spool.paddedLengthFeet.toFixed(1),
      spool.notes,
    ]);
  }

  for (const clip of bom.mountingHardware) {
    rows.push([
      'Mounting Hardware',
      clip.itemDescription,
      clip.packCount,
      `${clip.quantity} clips (${clip.surfaceMaterial})`,
      '',
      '',
      clip.attachmentMethod,
    ]);
  }

  for (const power of bom.powerDistribution) {
    rows.push([
      'Power Distribution',
      power.itemDescription,
      power.quantity,
      power.specRating,
      '',
      '',
      power.purpose,
    ]);
  }

  rows.push([
    'Telemetry Summary',
    'NEC Electrical & Ladder Totals',
    telemetry.totals.gfci15ACircuitsNeeded,
    `${telemetry.totals.totalWatts.toFixed(1)}W (${telemetry.totals.totalAmps120V.toFixed(2)}A @ 120V)`,
    telemetry.totals.totalLengthFeet.toFixed(1),
    '',
    `Max elevation ${telemetry.totals.maxHeightFeet.toFixed(1)} ft | Recommended ladder: ${telemetry.totals.recommendedLadderFeet} ft`,
  ]);

  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

export function formatBOMAsMarkdown(
  bom: BOMReport,
  telemetry: DesignTelemetry
): string {
  const lines: string[] = [
    '# Lumen3D Holiday Lighting Bill of Materials (BOM)',
    '',
    '## Electrical & Elevation Summary',
    `- **Total Lighted Length:** ${telemetry.totals.totalLengthFeet.toFixed(1)} ft (${telemetry.totals.totalBulbs} bulbs)`,
    `- **Total Power Load:** ${telemetry.totals.totalWatts.toFixed(1)} W (${telemetry.totals.totalAmps120V.toFixed(2)} A @ 120V)`,
    `- **NEC 15A GFCI Circuits Required (80% / 1,440W limit):** ${telemetry.totals.gfci15ACircuitsNeeded}`,
    `- **Max Elevation / Recommended Extension Ladder:** ${telemetry.totals.maxHeightFeet.toFixed(1)} ft / ${telemetry.totals.recommendedLadderFeet} ft`,
    '',
    '## 1. Light Spools (+12% Slack & Cut Allowance)',
    '| SKU Description | Preset | Net (ft) | +12% Slack (ft) | Qty | Notes |',
    '| :--- | :--- | ---: | ---: | ---: | :--- |',
  ];

  for (const s of bom.spools) {
    lines.push(
      `| ${s.skuDescription} | \`${s.bulbPreset}\` | ${s.netLengthFeet.toFixed(1)} | ${s.paddedLengthFeet.toFixed(1)} | **${s.quantityToPurchase}** (${s.unitLengthFeet}ft) | ${s.notes} |`
    );
  }

  lines.push(
    '',
    '## 2. Surface-Matched Mounting Hardware',
    '| Item Description | Surface | Clips Needed | Packs | Attachment Method |',
    '| :--- | :--- | ---: | ---: | :--- |'
  );
  for (const h of bom.mountingHardware) {
    lines.push(
      `| ${h.itemDescription} | \`${h.surfaceMaterial}\` | ${h.quantity} | **${h.packCount}** | ${h.attachmentMethod} |`
    );
  }

  lines.push(
    '',
    '## 3. Power Distribution & Control',
    '| Item Description | Qty | Spec Rating | Purpose |',
    '| :--- | ---: | :--- | :--- |'
  );
  for (const p of bom.powerDistribution) {
    lines.push(
      `| ${p.itemDescription} | **${p.quantity}** | ${p.specRating} | ${p.purpose} |`
    );
  }

  lines.push('', '## 4. Safety & Step-by-Step Installation Plan');
  for (const step of bom.safetyAndInstallPlan) {
    lines.push(
      `${step.stepNumber}. **${step.phase}:** ${step.instruction} *(Safety: ${step.safetyNote})*`
    );
  }

  if (bom.summaryNotes) {
    lines.push('', `> ${bom.summaryNotes}`);
  }

  return lines.join('\n');
}
