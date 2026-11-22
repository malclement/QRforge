/**
 * Live smoke test for the Claude Code bridge adapter. NOT part of `npm test`.
 *
 *   npm run smoke:claude
 *
 * Makes ONE real request through your installed Claude Code CLI, using its
 * existing subscription login. It counts against your plan's usage. It never
 * signs in or out, never sets or reads an API key, and never changes which
 * account or provider is used: if the CLI is not on a subscription login, it
 * stops before making any request.
 *
 * The brief sent is a fixed, fictional brand. No project data is involved.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArguments, inspectCli, requestSuggestions } from '../bridge/claude-cli.ts';
import { loadConfig } from '../bridge/config.ts';
import { DesignBriefSchema } from '../src/ai/brief.ts';

const brief = DesignBriefSchema.parse({
  briefVersion: 1,
  brand: {
    name: 'Kelvane Systems',
    palette: ['#2f5bff', '#0d1326', '#ffffff'],
    roles: { dark: '#0d1326', light: '#ffffff', accent: '#2f5bff', support: '#e9eeff' },
    logo: { present: true, aspect: 1, kind: 'vector' },
  },
  styleWords: ['bold'],
  instruction: 'Confident and technical, for a product launch poster.',
  count: 2,
});

const config = loadConfig(process.env);
const cwd = mkdtempSync(join(tmpdir(), 'qrstudio-smoke-'));
let exitCode = 0;
try {
  const state = await inspectCli(config, process.env, cwd);
  console.log(`Claude Code: ${state.version ?? 'not found'}`);
  console.log(`Authentication: ${state.authMethod ?? 'unknown'}${state.subscription ? ` (${state.subscription})` : ''}`);
  if (!state.ready) {
    console.error(`Not ready, no request was made: ${state.reason}`);
    exitCode = 2;
  } else {
    const flags = buildArguments(state, config.model).filter((arg) => arg.startsWith('--'));
    console.log(`Flags: ${flags.join(' ')}`);
    console.log('Sending one design brief (fictional brand)…');
    const result = await requestSuggestions(brief, state, config, process.env, cwd, undefined, (line) => console.log(`[cli] ${line}`));
    console.log(`OK in ${(result.durationMs / 1000).toFixed(1)} s: ${result.suggestions.suggestions.length} schema-valid suggestion(s).`);
    for (const s of result.suggestions.suggestions) console.log(`- ${s.preset} / ${s.modules.style}: ${s.title}`);
  }
} catch (error) {
  console.error(`Smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
process.exit(exitCode);
