import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GOOD_SUGGESTION } from '../tests/fixtures.ts';
import { blockExternalNetwork, collectErrors, verificationSettled } from './support.ts';

/**
 * The real bridge process and a real browser, with a scripted stand-in for the
 * Claude Code binary. No request reaches Anthropic.
 */
const PORT = 4391;
const STATE = resolve('tests/fixtures/.fake-claude-state.json');
let bridge: ChildProcess;
let pairing = '';
let work = '';

test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'qrstudio-e2e-bridge-'));
  writeFileSync(STATE, JSON.stringify({ log: join(work, 'calls.jsonl'), output: { suggestionsVersion: 1, suggestions: [{ ...GOOD_SUGGESTION, logo: { ...GOOD_SUGGESTION.logo, placement: 'none' } }] } }));
  bridge = spawn(process.execPath, ['bridge/main.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, QRSTUDIO_BRIDGE_PORT: String(PORT), QRSTUDIO_CLAUDE_BIN: resolve('tests/fixtures/fake-claude.mjs'), ANTHROPIC_API_KEY: 'sk-ant-must-not-be-forwarded' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pairing = await new Promise<string>((done, fail) => {
    let output = '';
    const timer = setTimeout(() => fail(new Error(`bridge did not start: ${output}`)), 20_000);
    bridge.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /Pairing code:\s+(\S+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        done(match[1]);
      }
    });
  });
});

test.afterAll(() => {
  bridge?.kill('SIGTERM');
  rmSync(work, { recursive: true, force: true });
  rmSync(STATE, { force: true });
});

test('paired bridge: status, an explicit request, validated suggestions added and verified', async ({ page }) => {
  const external = await blockExternalNetwork(page);
  const errors = collectErrors(page);
  const bridgeCalls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(`:${PORT}/`)) bridgeCalls.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });

  await page.goto(`/#bridge=${encodeURIComponent(pairing)}`);
  // The pairing code is taken out of the address bar.
  await expect.poll(() => page.url()).not.toContain('bridge=');
  await page.getByLabel('URL or text').fill('https://private.example/never-sent');
  await verificationSettled(page);
  // Editing does not contact the bridge.
  expect(bridgeCalls).toEqual([]);

  await page.getByRole('tab', { name: 'Assistant' }).click();
  await expect(page.getByText(`Paired with 127.0.0.1:${PORT}`)).toBeVisible();
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByText(/Ready\. Claude Code 9\.9\.9, signed in with claude\.ai \(max\)/)).toBeVisible();

  await page.getByRole('button', { name: 'Ask Claude for designs' }).click();
  await expect(page.getByText(/Added 1 suggestion/)).toBeVisible();
  await expect(page.locator('[data-testid^="variation-"]')).toHaveCount(7);
  await expect(page.getByTestId('variation-6')).toHaveAttribute('aria-label', /Harbour seal/);
  expect(await verificationSettled(page)).not.toBe('needs-changes');
  expect(bridgeCalls.filter((c) => c.startsWith('POST'))).toEqual(['POST /v1/suggest']);

  // What the CLI stand-in received: the brief on stdin, without the payload, and no inherited API key.
  const run = readFileSync(join(work, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)).find((call) => call.args.includes('--print'));
  expect(run.stdin).toContain('"briefVersion": 1');
  expect(run.stdin).not.toContain('private.example');
  expect(run.env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(run.args).toContain('--safe-mode');

  // Disconnecting forgets the pairing.
  await page.getByRole('button', { name: 'Disconnect the bridge' }).click();
  await expect(page.getByLabel('Pairing code')).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('a wrong pairing code is reported, and nothing is applied', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/');
  await page.getByLabel('URL or text').fill('https://example.com/x');
  await page.getByRole('tab', { name: 'Assistant' }).click();
  await page.getByLabel('Pairing code').fill(`${PORT}:${'x'.repeat(43)}`);
  await page.getByRole('button', { name: 'Pair' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Missing or wrong pairing code' })).toBeVisible();
  await expect(page.locator('[data-testid^="variation-"]')).toHaveCount(6);
});
