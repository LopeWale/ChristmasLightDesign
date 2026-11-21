import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('E2E 1: Clean Sidebar-Free Onboarding -> Sample House -> Scale Popover -> Floating Dock -> Slide-Over Critique & BOM CSV', async ({
  page,
}) => {
  await page.goto('/');

  // 1. Verify clean progressive onboarding: Launcher visible, ZERO sidebars/dock/telemetry clutter
  await expect(page.getByTestId('studio-launcher')).toBeVisible();
  await expect(page.getByTestId('floating-dock')).toHaveCount(0);
  await expect(page.getByTestId('telemetry-hud')).toHaveCount(0);
  await expect(page.getByTestId('copilot-drawer')).toHaveCount(0);

  // 2. Load Sample Suburban House
  await page.getByTestId('btn-load-sample-house').click();
  await expect(page.getByTestId('floating-dock')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('telemetry-hud')).toBeVisible();

  const canvas = page.locator('[data-testid="studio-viewport"] canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(500);

  // 3. Open Scale popover and Auto-Calibrate via Front Door
  await page.getByTestId('btn-toggle-scale').click();
  await expect(page.getByTestId('calibration-overlay')).toBeVisible();
  await page.getByTestId('btn-auto-calibrate').click();
  await expect(page.getByTestId('calibration-status-badge')).toContainText(
    'Auto-calibrated via Front Door: 6.67 ft'
  );

  // 4. Place roofline strand via Floating Dock & 3D canvas clicks, plus a Column Helix
  await page.getByTestId('tool-linear_eave').click();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.38, box.y + box.height * 0.45);
    await page.mouse.click(box.x + box.width * 0.56, box.y + box.height * 0.45);
  }

  await page.evaluate(() => {
    const win = window as unknown as {
      __LUMEN3D_STORE__?: {
        getState: () => {
          commitDraftRun: () => void;
          addRunDirect: (run: Record<string, unknown>) => void;
        };
      };
    };
    const st = win.__LUMEN3D_STORE__?.getState();
    st?.commitDraftRun();
    st?.addRunDirect({
      name: 'Main Front Gutter C9',
      toolMode: 'LINEAR_EAVE',
      bulbPreset: 'C9_LED',
      spacingInches: 12,
      colorsHex: ['#ffd996'],
      pattern: 'SOLID',
      controlPoints: [
        [-4.5, 3.3, 4.6],
        [4.5, 3.3, 4.6],
      ],
      surfaceMaterial: 'metal_gutter',
    });
    st?.addRunDirect({
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

  // 5. Verify live telemetry updates
  expect(parseFloat(await page.getByTestId('telemetry-total-feet').innerText())).toBeGreaterThan(20);
  expect(parseInt(await page.getByTestId('telemetry-total-bulbs').innerText(), 10)).toBeGreaterThan(25);

  // 6. Open Slide-Over AI Co-Pilot Drawer on demand & apply Concept Variation
  await page.getByTestId('btn-toggle-copilot').click();
  await expect(page.getByTestId('copilot-drawer')).toBeVisible();
  await page.getByTestId('btn-request-critique').click();
  await expect(page.getByTestId('critique-results')).toBeVisible();
  await expect(page.getByTestId('critique-score')).toContainText('/ 10');
  await page.getByTestId('btn-preview-concept-1').click();

  // 7. Switch to Shopping List (BOM) Drawer & export CSV
  await page.getByTestId('btn-toggle-bom').click();
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
    expect(csvContent).toContain('Mounting Hardware');
  }
});

test('E2E 2: 3-Story Condo (2 Balconies) -> Day-Mode High-Contrast HUD -> Walk-Out 0ft Ladder & HOA BOM -> Floors & Balconies Popover', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByTestId('btn-load-sample-condo').click();
  await expect(page.getByTestId('floating-dock')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);

  // Switch to Day mode and verify TelemetryHUD preserves high-contrast dark background (RGB < 25)
  await page.getByTestId('lighting-day').click();
  const hudBg = await page.getByTestId('telemetry-hud').evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor;
  });
  const rgbMatch = hudBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  expect(rgbMatch).not.toBeNull();
  if (rgbMatch) {
    expect(Number(rgbMatch[1])).toBeLessThan(25);
    expect(Number(rgbMatch[2])).toBeLessThan(25);
    expect(Number(rgbMatch[3])).toBeLessThan(35);
  }

  // Return to Night mode and place lights on both 2nd & 3rd floor balcony railings
  await page.getByTestId('lighting-night').click();
  await page.evaluate(() => {
    const win = window as unknown as {
      __LUMEN3D_STORE__?: {
        getState: () => {
          addRunDirect: (run: Record<string, unknown>) => void;
        };
      };
    };
    const store = win.__LUMEN3D_STORE__?.getState();
    store?.addRunDirect({
      name: '2nd Floor Balcony Railing',
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
    store?.addRunDirect({
      name: '3rd Floor Balcony Railing',
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

  // Walk-out balcony ladder rule: 0 ft exterior ladder ("/ —")
  await expect(page.getByTestId('telemetry-ladder')).toContainText('/ —');

  // Open Shopping List drawer and verify HOA-safe Railing Clamps
  await page.getByTestId('btn-toggle-bom').click();
  await page.getByTestId('btn-generate-bom').click();
  await expect(page.getByTestId('bom-report')).toContainText('Railing');
  await page.getByTestId('btn-close-drawer').click();
  await expect(page.getByTestId('copilot-drawer')).toHaveCount(0);

  // Open Floors & Balconies popover and rebuild with solid_parapet
  await page.getByTestId('btn-toggle-building-adjuster').click();
  await expect(page.getByTestId('building-adjuster-panel')).toBeVisible();
  await page.getByTestId('select-balcony-railing-0').selectOption('solid_parapet');
  await page.getByTestId('btn-rebuild-spec').click();
  await expect(page.getByTestId('floating-dock')).toBeVisible();
});

test('E2E 3: Street Address Submit (1007 N Shartel Ave, Oklahoma City, OK) -> Actionable Guide & Zero "fetch failed"', async ({
  page,
}) => {
  await page.goto('/');

  const addrInput = page.getByTestId('input-street-address');
  await addrInput.fill('1007 N Shartel Ave, Oklahoma City, OK');
  await addrInput.press('Enter');

  // When GOOGLE_MAPS_API_KEY is unset in offline CI, Launcher displays clear setup guide (never "fetch failed")
  const guide = page.getByTestId('launcher-maps-guide');
  await expect(guide).toBeVisible();
  const guideText = await guide.innerText();
  expect(guideText.toLowerCase()).not.toContain('fetch failed');

  // 1-click transition from guide into 3-Story Condo Studio
  await page.getByTestId('btn-guide-open-condo').click();
  await expect(page.getByTestId('floating-dock')).toBeVisible({ timeout: 15_000 });
});
