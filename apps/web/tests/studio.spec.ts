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

test('E2E 4: Photo Upload Reconstruction (Architectural 3D & Neural Depth + Splat) -> Completes Fast Without Timeout', async ({
  page,
}) => {
  await page.goto('/');

  // Create a valid 1x1 PNG buffer in memory? Better: use Playwright screenshot of canvas to get a crisp valid PNG!
  const pngBuffer = await page.locator('body').screenshot({ type: 'png' });

  // 1. Upload in Architectural 3D mode (default)
  await page.getByTestId('input-upload-files').setInputFiles({
    name: 'condo_front.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });

  await expect(page.getByTestId('floating-dock')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('launcher-error')).toHaveCount(0);

  // 2. Open Change Building modal, switch to Neural Depth + Splat (da3), and upload again
  await page.getByTestId('btn-change-building').click();
  await expect(page.getByTestId('studio-launcher')).toBeVisible();
  await page.getByTestId('mode-da3').click();
  await page.getByTestId('input-upload-files').setInputFiles({
    name: 'condo_splat.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });

  await expect(page.getByTestId('studio-launcher')).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.getByTestId('floating-dock')).toBeVisible();
});

test('E2E 5: Live Walkaround Camera Scan (Phone QR Pairing -> Mobile Multi-Angle Capture -> Live Desktop 3D + SparkJS Sync)', async ({
  page,
  context,
}) => {
  await page.goto('/');

  // Capture a high-contrast sharp PNG before opening QR scan modal
  const crispFramePng = await page
    .getByTestId('studio-launcher')
    .screenshot({ type: 'png' });

  // 1. Start Live Walkaround Camera Scan on Desktop
  await page.getByTestId('btn-start-live-scan').click();
  await expect(page.getByTestId('live-scan-modal')).toBeVisible();
  const qrSrc = await page
    .getByTestId('live-scan-qr-image')
    .getAttribute('src');
  expect(qrSrc).toMatch(/^data:image\/png;base64,/);

  const scanHref = await page
    .getByTestId('link-open-desktop-webcam-scanner')
    .getAttribute('href');
  expect(scanHref).toMatch(/^\/scan\/scan-/);

  // 2. Open paired Mobile Scanner in a second browser context tab
  const mobilePage = await context.newPage();
  await mobilePage.goto(scanHref!);
  await expect(mobilePage.getByTestId('mobile-live-scanner')).toBeVisible();
  await expect(mobilePage.getByTestId('sector-pill-front')).toBeVisible();

  // 3. Snap Front Elevation on mobile -> Desktop automatically transitions into 3D Studio (scene_r001)
  await mobilePage.getByTestId('sector-pill-front').click();
  await mobilePage.getByTestId('input-mobile-camera-file').setInputFiles({
    name: 'mobile_front.png',
    mimeType: 'image/png',
    buffer: crispFramePng,
  });

  await expect(page.getByTestId('live-scan-hud-pill')).toContainText(
    '1/5 angles',
    { timeout: 15_000 }
  );
  await expect(page.getByTestId('floating-dock')).toBeVisible();

  const rev1Glb = await page.evaluate(() => {
    const store = (window as unknown as { __LUMEN3D_STORE__?: { getState: () => { job?: { glbUrl?: string } } } })
      .__LUMEN3D_STORE__;
    return store?.getState().job?.glbUrl ?? '';
  });
  expect(rev1Glb).toContain('scene_r001.glb');

  // 4. Walk to Right Wall on mobile & snap frame #2 -> Desktop live-updates to 2/5 angles & scene_r002.glb/.splat
  await mobilePage.getByTestId('sector-pill-right_side').click();
  await mobilePage.getByTestId('input-mobile-camera-file').setInputFiles({
    name: 'mobile_right.png',
    mimeType: 'image/png',
    buffer: crispFramePng,
  });

  await expect(page.getByTestId('live-scan-hud-pill')).toContainText(
    '2/5 angles',
    { timeout: 15_000 }
  );

  const rev2Urls = await page.evaluate(() => {
    const store = (window as unknown as {
      __LUMEN3D_STORE__?: {
        getState: () => { job?: { glbUrl?: string; splatUrl?: string } };
      };
    }).__LUMEN3D_STORE__;
    return store?.getState().job ?? {};
  });
  expect(rev2Urls.glbUrl).toContain('scene_r002.glb');
  expect(rev2Urls.splatUrl).toContain('scene_r002.splat');

  // Finish scan cleanly
  await page.getByTestId('btn-finish-live-scan').click();
  await expect(page.getByTestId('live-scan-hud-pill')).toHaveCount(0);
  await mobilePage.close();
});
