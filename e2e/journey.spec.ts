import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { blockExternalNetwork, collectErrors, download, expectDecodes, pngToRaster, rasterizeSvg, verificationSettled } from './support.ts';

const PAYLOAD = 'https://kelvane.example/Launch?ref=poster&é=ü#Top';

test('content → logo → variation → edit → save → reopen → verify → export, with the internet blocked', async ({ page }) => {
  const external = await blockExternalNetwork(page);
  const errors = collectErrors(page);
  await page.goto('/');

  // Empty state: nothing to verify, nothing invented.
  await expect(page.getByText('Start with what the code should open')).toBeVisible();
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-status', 'none');

  // 1. Content: the preview shows the exact payload.
  await page.getByLabel('Project name').fill('Kelvane launch');
  await page.getByLabel('URL or text').fill(PAYLOAD);
  await expect(page.getByTestId('payload-preview')).toHaveText(PAYLOAD);
  await expect(page.getByTestId('payload-bytes')).toHaveText(`${new TextEncoder().encode(PAYLOAD).length} bytes`);
  await expect(page.getByTestId('artboard-image')).toBeVisible();

  // 2. Logo: uploaded, sanitized, palette extracted and roles proposed.
  await page.locator('#logo-file').setInputFiles('public/examples/logos/kelvane.svg');
  await expect(page.getByText(/vector \(sanitized\)/)).toBeVisible();
  await expect(page.getByText('Extracted from the logo')).toBeVisible();
  await page.getByText('How these roles were chosen').click();
  await expect(page.getByText(/most saturated colour in the logo/)).toBeVisible();

  // 3. Six real variations, each rendered from the current payload and logo.
  for (let i = 0; i < 6; i++) await expect(page.getByTestId(`variation-${i}`).locator('img')).toBeVisible();
  const sources = await page.locator('[data-testid^="variation-"] img').evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
  expect(new Set(sources).size).toBe(6);

  // 4. Select and edit a variation.
  await page.getByTestId('variation-5').click();
  await expect(page.getByTestId('variation-5')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: 'Design' }).click();
  await page.getByRole('radiogroup', { name: 'Data module shape' }).getByRole('radio', { name: 'Dots' }).click();
  await page.getByLabel('Caption', { exact: true }).last().fill('Launch day');
  const edited = await page.getByTestId('artboard-image').getAttribute('src');

  // Undo and redo are real document operations.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('artboard-image')).not.toHaveAttribute('src', edited as string);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByTestId('artboard-image')).toHaveAttribute('src', edited as string);

  // 5. Save, reload, and find the same project, design and payload.
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expect(page.getByLabel('Project name')).toHaveValue('Kelvane launch');
  await expect(page.getByLabel('URL or text')).toHaveValue(PAYLOAD);
  await expect(page.getByTestId('variation-5')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('artboard-image')).toHaveAttribute('src', edited as string);

  // 6. Verification of the finished artwork.
  const status = await verificationSettled(page);
  expect(['stress-passed', 'baseline-verified']).toContain(status);
  await page.getByTestId('status-pill').click();
  await expect(page.getByTestId('verify-status')).toHaveAttribute('data-status', status);
  await expect(page.getByText(/6 of 6 baseline checks passed; \d+ of 20 simulated stress checks passed/)).toBeVisible();
  await expect(page.getByText('PNG, exact download bytes')).toBeVisible();

  // 7. Export. The downloaded files are decoded here, outside the app, by both decoders.
  await page.getByTestId('open-export').click();
  const png = await download(page, 'download-png');
  const svg = await download(page, 'download-svg');
  const report = await download(page, 'download-report');
  expect(png.name).toMatch(/\.png$/);
  expect(png.name).not.toMatch(/unverified/);

  await expectDecodes(pngToRaster(png.path), PAYLOAD, 'downloaded PNG');
  const svgText = readFileSync(svg.path, 'utf8');
  for (const width of [512, 1024]) await expectDecodes(rasterizeSvg(svgText, width), PAYLOAD, `downloaded SVG at ${width}px`);

  // The report describes exactly these bytes.
  const parsed = JSON.parse(readFileSync(report.path, 'utf8'));
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  expect(parsed.artifacts.png.sha256).toBe(sha(png.path));
  expect(parsed.artifacts.svg.sha256).toBe(sha(svg.path));
  expect(parsed.baseline.passed).toBe(true);
  expect(parsed.experimentalOverride).toBe(false);
  expect(parsed.decoders.map((d: { id: string }) => d.id)).toEqual(['jsqr', 'zxing-cpp']);
  expect(parsed.stress.total).toBe(20);
  expect(JSON.stringify(parsed)).not.toContain('kelvane.example');

  // The SVG is self-contained vector artwork.
  expect(svgText).toContain('<path');
  expect(svgText).not.toMatch(/<text|<script|font-family/);
  expect([...svgText.matchAll(/href="([^"]{0,12})/g)].every((m) => m[1].startsWith('data:image/'))).toBe(true);

  expect(external, 'no request may leave this machine').toEqual([]);
  expect(errors).toEqual([]);
});
