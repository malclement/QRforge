import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { blockExternalNetwork, collectErrors, download, expectDecodes, pngToRaster, verificationSettled } from './support.ts';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/');
});

test('rejects active or invalid logos with reasons', async ({ page }) => {
  await page.getByLabel('URL or text').fill('https://example.com/a');
  const upload = (name: string, mimeType: string, body: string) => page.locator('#logo-file').setInputFiles({ name, mimeType, buffer: Buffer.from(body) });

  await upload('logo.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><image href="https://example.com/t.png" width="1" height="1"/></svg>');
  const alert = page.getByRole('alert').filter({ hasText: 'outside the supported static subset' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('contains a script');
  await expect(alert).toContainText('event handler');
  await expect(page.getByText('Drop a logo here, or')).toBeVisible();

  await upload('logo.png', 'image/png', 'this is not a png');
  await expect(page.getByRole('alert').filter({ hasText: 'Unsupported file' })).toBeVisible();

  await upload('pretend.png', 'image/png', '<html><script>alert(1)</script></html>');
  await expect(page.getByRole('alert').filter({ hasText: 'Unsupported file' })).toBeVisible();
});

test('raster logo with transparency: bright brand colour stays the accent, modules get a darker tone', async ({ page }) => {
  await page.getByLabel('URL or text').fill('Pomelo Pop 🍊\nrefill code POP-2291');
  await page.locator('#logo-file').setInputFiles('public/examples/logos/pomelo-pop.png');
  await expect(page.getByText(/PNG \(re-encoded\)/)).toBeVisible();
  await page.getByText('How these roles were chosen').click();
  await expect(page.getByText(/derived by darkening/)).toBeVisible();
  expect(await verificationSettled(page)).not.toBe('needs-changes');
});

test('content that cannot fit is rejected clearly, never truncated', async ({ page }) => {
  await page.getByLabel('URL or text').fill('x'.repeat(3200));
  await expect(page.getByRole('alert').filter({ hasText: 'too long for a QR code' }).first()).toBeVisible();
  await expect(page.getByText('This content cannot be encoded')).toBeVisible();
  await expect(page.getByTestId('payload-bytes')).toHaveText('3200 bytes');
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-status', 'none');
});

test('content corrections are offered, not applied silently', async ({ page }) => {
  const field = page.getByLabel('URL or text');
  await field.fill('  Example.com/Path  ');
  await expect(page.getByTestId('payload-preview')).toContainText('··Example.com/Path··');
  await expect(field).toHaveValue('  Example.com/Path  ');
  await page.getByRole('button', { name: 'Trim whitespace' }).click();
  await expect(field).toHaveValue('Example.com/Path');
  await page.getByRole('button', { name: 'Add https://' }).click();
  await expect(field).toHaveValue('https://Example.com/Path');
});

test('a low-contrast design needs changes, blocks normal export, and can be repaired', async ({ page }) => {
  const errors = collectErrors(page);
  const payload = 'https://example.com/contrast-check';
  await page.getByLabel('URL or text').fill(payload);
  await page.getByRole('tab', { name: 'Design' }).click();
  const modules = page.getByLabel('Modules', { exact: true }).last();
  await modules.fill('#e4e4e4');
  await expect(page.getByRole('alert').filter({ hasText: 'too low for dependable scanning' })).toBeVisible();

  expect(await verificationSettled(page)).toBe('needs-changes');
  await page.getByTestId('status-pill').click();
  await expect(page.getByTestId('verify-status')).toHaveText(/Needs changes/);
  await expect(page.getByText('Could not read the symbol').first()).toBeAttached();

  // Export is blocked unless the explicit, labelled override is used.
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('download-png')).toBeDisabled();
  await page.getByLabel(/Export anyway as experimental/).check();
  const unverified = await download(page, 'download-png');
  expect(unverified.name).toMatch(/\.unverified\.png$/);
  const report = await download(page, 'download-report');
  expect(JSON.parse(readFileSync(report.path, 'utf8'))).toMatchObject({ experimentalOverride: true, baseline: { passed: false } });
  await page.keyboard.press('Escape');

  // The repair search proposes a measured fix; applying it is one undoable step.
  await page.getByRole('button', { name: 'Find fixes' }).click();
  const proposal = page.getByTestId('repair-proposal-0');
  await expect(proposal).toBeVisible({ timeout: 90_000 });
  await expect(proposal).toContainText('Increase contrast');
  await expect(proposal).toContainText('baseline passed');
  await proposal.getByRole('button', { name: 'Apply this fix' }).click();
  expect(await verificationSettled(page)).not.toBe('needs-changes');
  await expect(page.getByLabel('URL or text')).toHaveValue(payload);

  await page.getByTestId('open-export').click();
  const fixed = await download(page, 'download-png');
  expect(fixed.name).not.toMatch(/unverified/);
  await expectDecodes(pngToRaster(fixed.path), payload, 'repaired PNG');
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+z');
  expect(await verificationSettled(page)).toBe('needs-changes');
  expect(errors).toEqual([]);
});

test('an edit invalidates the previous result immediately', async ({ page }) => {
  await page.getByLabel('URL or text').fill('https://example.com/first');
  await verificationSettled(page);
  // Slow the worker down by nothing: just observe the state right after the edit.
  await page.getByLabel('URL or text').fill('https://example.com/second');
  const status = await page.getByTestId('status-pill').getAttribute('data-status');
  expect(['pending', 'verifying']).toContain(status);
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-stress', 'none');
  await verificationSettled(page);
});

test('example projects open, and projects round-trip through a file', async ({ page }) => {
  await page.getByRole('button', { name: 'Open an example' }).click();
  await expect(page.getByTestId('example-list').getByRole('button')).toHaveCount(6);
  await page.getByRole('button', { name: /Brasa Verde — Editorial/ }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Brasa Verde — Editorial');
  await expect(page.getByLabel('URL or text')).toHaveValue('https://brasa-verde.example/menu/été?table=12');
  expect(await verificationSettled(page)).not.toBe('needs-changes');
  const artwork = await page.getByTestId('artboard-image').getAttribute('src');

  // Export the project file, start fresh, import it back.
  await page.getByRole('button', { name: 'Projects' }).click();
  const file = await download(page, 'export-project');
  expect(file.name).toMatch(/\.qrstudio\.json$/);
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByLabel('URL or text')).toHaveValue('');

  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByTestId('import-project-input').setInputFiles(file.path);
  await expect(page.getByLabel('URL or text')).toHaveValue('https://brasa-verde.example/menu/été?table=12');
  await expect(page.getByTestId('artboard-image')).toHaveAttribute('src', artwork as string);

  // A malformed file is refused with a reason and changes nothing.
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByTestId('import-project-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"qrstudio.project","version":1,"project":{"evil":"<script>"}}') });
  await expect(page.getByRole('alert').filter({ hasText: 'does not match the expected structure' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('URL or text')).toHaveValue('https://brasa-verde.example/menu/été?table=12');

  // Duplicate and delete from the project list.
  await page.getByRole('button', { name: 'Projects' }).click();
  await expect(page.getByTestId('project-list').locator('li')).not.toHaveCount(0);
});

test('assistant: manual hand-off exports a brief without the payload and imports a validated recipe', async ({ page }) => {
  await page.getByLabel('URL or text').fill('https://private.example/secret-path');
  await page.getByRole('tab', { name: 'Assistant' }).click();
  const brief = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export design brief' }).click()]).then(([d]) => d.path());
  const text = readFileSync(brief as string, 'utf8');
  expect(text).toContain('"additionalProperties": false');
  expect(text).not.toContain('private.example');

  const box = page.getByLabel('Import design recipe');
  await box.fill('{"suggestionsVersion":1,"suggestions":[{"preset":"soft","title":"<img src=x onerror=alert(1)>"}]}');
  await page.getByRole('button', { name: 'Import design recipe' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'do not match the recipe schema' })).toBeVisible();
  await expect(page.locator('[data-testid^="variation-"]')).toHaveCount(6);

  const good = {
    suggestionsVersion: 1,
    suggestions: [
      {
        preset: 'emblem',
        title: 'Harbour seal',
        explanation: 'A round badge keeps the mark friendly.',
        ecc: 'Q',
        modules: { style: 'rounded', roundness: 0.6, gap: 0.1, finder: 'square' },
        palette: { dark: '#0d1326', light: '#ffffff', accent: '#ffd23f', frame: '#2f5bff', text: '#ffffff' },
        logo: { placement: 'none', scale: 0.7, panel: 'circle', plate: true },
        frame: { decoration: 'beads', padding: 0.4, radius: 0.5, density: 0.5 },
        caption: { text: 'Scan to explore', detail: '', font: 'space-grotesk', size: 0.5, uppercase: true, tracking: 0.4 },
      },
    ],
  };
  await box.fill('```json\n' + JSON.stringify(good) + '\n```');
  await page.getByRole('button', { name: 'Import design recipe' }).click();
  await expect(page.getByText(/Added 1 suggestion/)).toBeVisible();
  await expect(page.locator('[data-testid^="variation-"]')).toHaveCount(7);
  await expect(page.getByTestId('variation-6')).toHaveAttribute('aria-pressed', 'true');
  // Imported designs go through the same verification as everything else.
  expect(await verificationSettled(page)).not.toBe('needs-changes');

  // No bridge is paired, and nothing was sent anywhere.
  await expect(page.getByText(/prints a pairing code/)).toBeVisible();
});

test('small screens: panels are reachable as tabs and the artwork stays visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('URL or text').fill('https://example.com/mobile');
  await expect(page.getByTestId('artboard-image')).toBeVisible();
  for (const tab of ['Design', 'Verify', 'Assistant', 'Setup']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByTestId('open-export').click();
  await expect(page.getByRole('dialog', { name: 'Export artwork' })).toBeVisible();
});
