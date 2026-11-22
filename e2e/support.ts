import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { bytesEqual } from '../src/core/util/bytes.ts';
import { flatten, type Raster } from '../src/core/verify/raster.ts';
import { nodeDecoders, rasterizeSvg } from '../tests/helpers.ts';

/** Block everything that is not this machine, and record any attempt. */
export async function blockExternalNetwork(page: Page): Promise<string[]> {
  const attempts: string[] = [];
  await page.context().route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    attempts.push(route.request().url());
    return route.abort();
  });
  return attempts;
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

const SETTLED = ['stress-passed', 'baseline-verified', 'needs-changes'];

/** Wait until the full profile has run for the design now on the artboard. */
export async function verificationSettled(page: Page): Promise<string> {
  const pill = page.getByTestId('status-pill');
  await expect(pill).toHaveAttribute('data-stress', 'ran');
  await expect.poll(async () => SETTLED.includes((await pill.getAttribute('data-status')) ?? ''), { timeout: 60_000 }).toBe(true);
  return (await pill.getAttribute('data-status')) as string;
}

export function pngToRaster(path: string): Raster {
  const png = PNG.sync.read(readFileSync(path));
  return flatten({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength) });
}

/** Both independent decoders must return exactly `expected` from these pixels. */
export async function expectDecodes(raster: Raster, expected: string, label: string): Promise<void> {
  const bytes = new TextEncoder().encode(expected);
  for (const decoder of nodeDecoders()) {
    const result = await decoder.decode(raster);
    expect(result.decoded, `${label}: ${decoder.id} could not decode (${result.detail ?? ''})`).toBe(true);
    expect(bytesEqual(result.bytes as Uint8Array, bytes), `${label}: ${decoder.id} returned a different payload`).toBe(true);
  }
}

export async function download(page: Page, testId: string): Promise<{ path: string; name: string }> {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
  return { path: (await file.path()) as string, name: file.suggestedFilename() };
}

export { rasterizeSvg };
