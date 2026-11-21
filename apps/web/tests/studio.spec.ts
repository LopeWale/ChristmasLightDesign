import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('Gate 5 E2E: Sample House -> 3D Night Canvas -> Calibrate -> Roofline & Column Wrap -> Telemetry -> Critique & BOM CSV', async ({
  page,
}) => {
  await page.goto('/');

  // 1. Trigger instant synthetic 3D house reconstruction via "Load Sample House"
  const loadSampleBtn = page.getByTestId('btn-load-sample-house');
  await expect(loadSampleBtn).toBeVisible();
  await loadSampleBtn.click();

  // 2. Verify scene.glb completes and renders in 3D Night Canvas
  const calibrationOverlay = page.getByTestId('calibration-overlay');
  await expect(calibrationOverlay).toBeVisible({ timeout: 20_000 });

  const canvas = page.locator('[data-testid="studio-viewport"] canvas');
  await expect(canvas).toBeVisible();

  // Wait until GLTFLoader finishes mounting the 3D house mesh into R3F scene
  await page.waitForFunction(
    () => {
      const c = document.querySelector(
        '[data-testid="studio-viewport"] canvas'
      ) as HTMLCanvasElement | null;
      if (!c || c.width === 0 || c.height === 0) return false;
      const dataUrl = c.toDataURL('image/png');
      return dataUrl.startsWith('data:image/png;base64,') && dataUrl.length > 2000;
    },
    undefined,
    { timeout: 15_000 }
  );

  // Give GLTFLoader an extra beat to ensure sceneGroupRef is populated
  await page.waitForTimeout(400);

  // 3. Auto-calibrate metric scale via Gemini Front Door 3D back-projection
  await page.getByTestId('btn-auto-calibrate').click();
  await expect(page.getByTestId('calibration-status-badge')).toContainText(
    'Auto-calibrated via Front Door: 6.67 ft'
  );

  // 4. Place a Linear / Eave roofline run by clicking directly on the 3D house canvas
  await page.getByTestId('tool-linear_eave').click();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.36, box.y + box.height * 0.44);
    await page.mouse.click(box.x + box.width * 0.56, box.y + box.height * 0.44);
  }
  await expect(page.getByTestId('btn-finish-run')).toBeVisible();
  await page.getByTestId('btn-finish-run').click();

  // Place a 3D Helical Column Wrap around the left front porch column
  await page.evaluate(() => {
    const win = window as unknown as {
      __LUMEN3D_STORE__?: {
        getState: () => {
          addRunDirect: (run: Record<string, unknown>) => void;
        };
      };
    };
    win.__LUMEN3D_STORE__?.getState().addRunDirect({
      name: 'Left Porch Column Helix',
      toolMode: 'HELICAL_WRAP',
      bulbPreset: 'MINI_5MM_LED',
      spacingInches: 4,
      colorsHex: ['#ffd996'],
      pattern: 'SOLID',
      controlPoints: [
        [-1.85, 0.14, 3.68],
        [-1.85, 3.05, 3.68],
      ],
      helixParams: {
        baseCenter: [-1.85, 0.14, 3.68],
        topCenter: [-1.85, 3.05, 3.68],
        radius: 0.14,
        turns: 6,
      },
      surfaceMaterial: 'column_post',
    });
  });

  // 5. Verify TelemetryHUD updates live footage, bulb counts & watts
  const totalFeetText = await page.getByTestId('telemetry-total-feet').innerText();
  const parsedFeet = parseFloat(totalFeetText);
  expect(parsedFeet).toBeGreaterThan(15);

  const totalBulbsText = await page.getByTestId('telemetry-total-bulbs').innerText();
  expect(parseInt(totalBulbsText, 10)).toBeGreaterThan(20);

  const totalWattsText = await page.getByTestId('telemetry-total-watts').innerText();
  expect(parseFloat(totalWattsText)).toBeGreaterThan(5);

  // 6. Request Co-Pilot Critique & preview a Concept Preset in 3D
  await page.getByTestId('btn-request-critique').click();
  await expect(page.getByTestId('critique-results')).toBeVisible();
  await expect(page.getByTestId('critique-score')).toContainText('/ 10');
  await page.getByTestId('btn-preview-concept-1').click();

  // 7. Request Hardware & Electrical BOM -> verify structured table & CSV download
  await page.getByTestId('btn-generate-bom').click();
  await expect(page.getByTestId('bom-report')).toBeVisible();
  await expect(page.getByTestId('bom-spools-table')).toContainText('C9');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('btn-export-bom-csv').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('lumen3d-bom.csv');

  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  if (downloadedPath) {
    const csvContent = fs.readFileSync(downloadedPath, 'utf8');
    expect(csvContent).toContain('Category,Item / SKU,Quantity');
    expect(csvContent).toContain('Light Spools');
    expect(csvContent).toContain('Mounting Hardware');
  }
});

test('3-Story Condo (2 Balconies): Load Condo -> Light Both Balcony Railings -> Verify 0ft Walk-Out Ladder & HOA BOM -> Rebuild via Balcony Adjuster', async ({
  page,
}) => {
  await page.goto('/');

  // 1. Click "Sample 3F Condo"
  await page.getByTestId('btn-load-sample-condo').click();
  await expect(page.getByTestId('calibration-overlay')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('building-adjuster-panel')).toBeVisible();

  await page.waitForTimeout(500);

  // 2. Auto-calibrate via front door on the 3-story condo
  await page.getByTestId('btn-auto-calibrate').click();
  await expect(page.getByTestId('calibration-status-badge')).toContainText(
    'Auto-calibrated via Front Door: 6.67 ft'
  );

  // 3. Place holiday lights along both 2nd-floor and 3rd-floor walk-out balcony railings
  await page.evaluate(() => {
    const win = window as unknown as {
      __LUMEN3D_STORE__?: {
        getState: () => {
          addRunDirect: (run: Record<string, unknown>) => void;
        };
      };
    };
    const store = win.__LUMEN3D_STORE__?.getState();
    if (!store) return;

    store.addRunDirect({
      name: '2nd Floor Balcony Railing Wrap',
      toolMode: 'LINEAR_EAVE',
      bulbPreset: 'C9_LED',
      spacingInches: 8,
      colorsHex: ['#ffd996', '#ff2424'],
      pattern: 'ALTERNATING',
      controlPoints: [
        [-4.5, 4.27, 6.26],
        [-0.9, 4.27, 6.26],
      ],
      surfaceMaterial: 'balcony_railing',
    });

    store.addRunDirect({
      name: '3rd Floor Balcony Railing Wrap',
      toolMode: 'LINEAR_EAVE',
      bulbPreset: 'C9_LED',
      spacingInches: 8,
      colorsHex: ['#ffd996', '#ff2424'],
      pattern: 'CANDY_CANE',
      controlPoints: [
        [0.9, 7.37, 6.26],
        [4.5, 7.37, 6.26],
      ],
      surfaceMaterial: 'balcony_railing',
    });
  });

  // 4. Verify walk-out balcony ladder rule: max height > 20ft, recommended exterior ladder = "—" (0 ft!)
  await expect(page.getByTestId('telemetry-ladder')).toContainText('/ —');

  // 5. Generate HOA-safe Hardware BOM and verify non-drilling Railing Clamps
  await page.getByTestId('btn-generate-bom').click();
  await expect(page.getByTestId('bom-report')).toBeVisible();
  await expect(page.getByTestId('bom-report')).toContainText('Railing');

  // 6. Change Balcony #1 railing to solid_parapet and click Rebuild 3D Mesh (<1s live update)
  await page
    .getByTestId('select-balcony-railing-0')
    .selectOption('solid_parapet');
  await page.getByTestId('btn-rebuild-spec').click();
  await expect(page.getByTestId('building-adjuster-panel')).toBeVisible();
});
