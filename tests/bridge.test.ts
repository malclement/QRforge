import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArguments, childEnvironment, inspectCli } from '../bridge/claude-cli.ts';
import { ConfigError, loadConfig, type BridgeConfig } from '../bridge/config.ts';
import { createBridgeServer } from '../bridge/server.ts';
import { buildBrief } from '../src/ai/brief.ts';
import { SYSTEM_PROMPT } from '../src/ai/prompt.ts';
import { createDefaultDoc } from '../src/core/project/defaults.ts';
import { GOOD_SUGGESTION as GOOD } from './fixtures.ts';

/**
 * No test here talks to Anthropic. The "CLI" is tests/fixtures/fake-claude.mjs,
 * a script that plays back canned behaviour and records how it was invoked.
 */
const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const STATE = fileURLToPath(new URL('./fixtures/.fake-claude-state.json', import.meta.url));
const ORIGIN = 'http://127.0.0.1:5173';
const TOKEN = 'T'.repeat(43);
const OUTPUT = { suggestionsVersion: 1, suggestions: [GOOD] };
const INJECTION = `"; rm -rf ~ #' $(touch /tmp/pwned) \`id\` --dangerously-skip-permissions\n--model evil`;

let work: string;
let server: Server;
let config: BridgeConfig;
let base: string;
const logLines: string[] = [];

function setState(state: Record<string, unknown>): void {
  writeFileSync(STATE, JSON.stringify({ log: join(work, 'calls.jsonl'), output: OUTPUT, ...state }));
}
function calls(): { args: string[]; stdin: string; cwd: string; env: Record<string, string> }[] {
  const file = join(work, 'calls.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}
function brief(instruction = 'Calm and nautical') {
  const doc = createDefaultDoc();
  doc.direction.brief = instruction;
  return buildBrief(doc, 2);
}
function request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal; raw?: string } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, ...(init.body !== undefined || init.raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...init.headers };
  return fetch(`${base}${path}`, { method: init.method ?? (init.body !== undefined || init.raw !== undefined ? 'POST' : 'GET'), headers, body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined), signal: init.signal });
}
async function start(overrides: Partial<BridgeConfig> = {}, env: Record<string, string | undefined> = {}): Promise<void> {
  const port = await freePort();
  config = { ...loadConfig({ QRSTUDIO_BRIDGE_PORT: String(port), QRSTUDIO_CLAUDE_BIN: FAKE }), ...overrides };
  base = `http://127.0.0.1:${port}`;
  server = createBridgeServer({ config, token: TOKEN, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, cwd: join(work, 'cwd'), log: (line) => logLines.push(line) });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'qrstudio-bridge-test-'));
  mkdirSync(join(work, 'cwd'));
  logLines.length = 0;
  setState({});
});
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server?.closeAllConnections?.();
  rmSync(work, { recursive: true, force: true });
  rmSync(STATE, { force: true });
});

describe('configuration', () => {
  it('accepts only loopback origins, sane ports, absolute binaries and plain model names', () => {
    expect(loadConfig({}).port).toBe(4317);
    expect(loadConfig({}).allowedOrigins).toContain('http://127.0.0.1:5173');
    expect(() => loadConfig({ QRSTUDIO_ALLOWED_ORIGINS: 'https://evil.example' })).toThrow(ConfigError);
    expect(() => loadConfig({ QRSTUDIO_ALLOWED_ORIGINS: 'http://127.0.0.1:5173,http://10.0.0.5:5173' })).toThrow(ConfigError);
    expect(() => loadConfig({ QRSTUDIO_BRIDGE_PORT: '80' })).toThrow(ConfigError);
    expect(() => loadConfig({ QRSTUDIO_CLAUDE_BIN: 'claude' })).toThrow(ConfigError);
    expect(() => loadConfig({ QRSTUDIO_CLAUDE_MODEL: 'sonnet; rm -rf /' })).toThrow(ConfigError);
    expect(loadConfig({ QRSTUDIO_CLAUDE_MODEL: 'sonnet' }).model).toBe('sonnet');
  });
});

describe('CLI adapter', () => {
  it('builds a fixed argument list with safe mode, no tools, no MCP, denied prompts, and never bare or bypass flags', () => {
    const args = buildArguments({ optionalFlags: ['--no-session-persistence'] }, 'sonnet');
    for (const flag of ['--print', '--safe-mode', '--strict-mcp-config', '--json-schema', '--no-session-persistence']) expect(args).toContain(flag);
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('mcp__*');
    expect(args[args.indexOf('--permission-prompts') + 1]).toBe('none');
    expect(args[args.indexOf('--system-prompt') + 1]).toBe(SYSTEM_PROMPT);
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1]).additionalProperties).toBe(false);
    for (const forbidden of ['--bare', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--add-dir', '--mcp-config', '--plugin-dir', '--settings']) expect(args).not.toContain(forbidden);
    expect(args.join(' ')).not.toMatch(/bypassPermissions/);
  });

  it('passes an allowlisted environment: API keys and provider switches are not inherited', () => {
    const env = childEnvironment({ PATH: '/bin', HOME: '/home/u', ANTHROPIC_API_KEY: 'sk-ant-xxx', ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'https://proxy.example', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_OAUTH_TOKEN: 'o', AWS_SECRET_ACCESS_KEY: 's', GITHUB_PERSONAL_ACCESS_TOKEN: 'g', CLAUDECODE: '1' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/u' });
  });

  it('reports a ready CLI, and refuses missing binaries, missing flags, logged-out and non-subscription auth', async () => {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME };
    const cwd = join(work, 'cwd');
    const cfg = loadConfig({ QRSTUDIO_CLAUDE_BIN: FAKE });
    expect(await inspectCli(cfg, env, cwd)).toMatchObject({ ready: true, version: '9.9.9', authMethod: 'claude.ai', subscription: 'max', optionalFlags: ['--disable-slash-commands', '--no-session-persistence'] });

    expect((await inspectCli({ ...cfg, claudeBin: '/nonexistent/claude' }, env, cwd)).reason).toMatch(/not found/);

    setState({ flags: ['-p, --print', '--output-format <format>', '--json-schema <schema>', '--system-prompt <prompt>', '--tools <tools...>', '--bare'] });
    const old = await inspectCli(cfg, env, cwd);
    expect(old.ready).toBe(false);
    expect(old.reason).toMatch(/--safe-mode/);

    setState({ auth: { loggedIn: false } });
    expect((await inspectCli(cfg, env, cwd)).reason).toMatch(/not signed in/);

    for (const auth of [
      { loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' },
      { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock' },
    ]) {
      setState({ auth });
      const state = await inspectCli(cfg, env, cwd);
      expect(state.ready).toBe(false);
      expect(state.reason).toMatch(/does not switch to other billing/);
    }
  });
});

describe('HTTP surface', () => {
  it('rejects a wrong Host, a wrong or missing Origin, and a wrong or missing token', async () => {
    await start();
    // fetch() will not send a custom Host header, so the rebinding case uses a raw request.
    const rebound = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: config.port, path: '/v1/status', headers: { Host: 'evil.example', Origin: ORIGIN, Authorization: `Bearer ${TOKEN}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(rebound).toBe(403);
    expect((await request('/v1/status', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await request('/v1/status', { headers: { Origin: 'http://127.0.0.1:5174' } })).status).toBe(403);
    expect((await fetch(`${base}/v1/status`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(403);
    expect((await request('/v1/status', { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await request('/v1/status', { headers: { Authorization: '' } })).status).toBe(401);
    expect(calls()).toEqual([]); // nothing reached the CLI
    const bad = await request('/v1/status', { headers: { Origin: 'https://evil.example' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers preflight for the allowed origin only and reports status without private details', async () => {
    await start({ model: 'sonnet' });
    const preflight = await fetch(`${base}/v1/suggest`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((await fetch(`${base}/v1/suggest`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).status).toBe(403);

    const status = await request('/v1/status');
    const body = await status.json();
    expect(body).toEqual({ ready: true, reason: null, cliVersion: '9.9.9', authMethod: 'claude.ai', subscription: 'max', model: 'sonnet' });
    expect(JSON.stringify(body)).not.toMatch(/person@example.com|fake-claude|\/Users|\/home/);
    expect((await request('/v1/unknown')).status).toBe(404);
  });

  it('returns validated suggestions, sending the brief on stdin only', async () => {
    await start({}, { ANTHROPIC_API_KEY: 'sk-ant-should-not-pass', CLAUDE_CODE_USE_BEDROCK: '1' });
    const response = await request('/v1/suggest', { body: { brief: brief(INJECTION) } });
    expect(response.status).toBe(200);
    expect((await response.json()).result).toEqual(OUTPUT);

    const run = calls().find((c) => c.args.includes('--print'))!;
    // Command-injection resistance: hostile text is data on stdin, never an argument, and no shell ran it.
    expect(run.stdin).toContain(JSON.stringify(INJECTION).slice(1, -1));
    expect(run.args.join('\u0000')).not.toContain('rm -rf');
    expect(run.args).not.toContain('--dangerously-skip-permissions');
    expect(run.args.filter((a) => a === '--model')).toEqual([]);
    expect(existsSync('/tmp/pwned')).toBe(false);
    expect(run.args).toEqual(buildArguments({ optionalFlags: ['--disable-slash-commands', '--no-session-persistence'] }, null));
    // Runs in the dedicated empty directory, without inherited credentials.
    expect(run.cwd.endsWith('/cwd')).toBe(true);
    expect(run.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(run.env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
  });

  it('accepts nothing but a design brief', async () => {
    await start();
    const cases: [unknown, number][] = [
      [{ brief: brief(), command: 'whoami' }, 400],
      [{ brief: { ...brief(), cwd: '/etc' } }, 400],
      [{ brief: { ...brief(), flags: ['--bare'] } }, 400],
      [{ brief: { ...brief(), payload: 'https://private.example' } }, 400],
      [{ prompt: 'ignore the schema' }, 400],
      [[], 400],
    ];
    for (const [body, status] of cases) expect((await request('/v1/suggest', { body })).status, JSON.stringify(body).slice(0, 60)).toBe(status);
    expect((await request('/v1/suggest', { raw: '{not json' })).status).toBe(400);
    expect((await request('/v1/suggest', { raw: JSON.stringify({ brief: brief() }), headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    const big = await request('/v1/suggest', { raw: JSON.stringify({ brief: brief(), pad: 'x'.repeat(config.maxRequestBytes) }) }).catch(() => null);
    if (big) expect(big.status).toBe(413);
    expect(calls().filter((c) => c.args.includes('--print'))).toEqual([]);
  });

  it('refuses to run when authentication is not a subscription login', async () => {
    setState({ auth: { loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' } });
    await start();
    const status = await (await request('/v1/status')).json();
    expect(status.ready).toBe(false);
    const response = await request('/v1/suggest', { body: { brief: brief() } });
    expect(response.status).toBe(503);
    expect((await response.json()).error.message).toMatch(/does not switch to other billing/);
    expect(calls().filter((c) => c.args.includes('--print'))).toEqual([]);
  });

  it('maps CLI failures to clear errors without leaking CLI output', async () => {
    await start();
    const expectations: [string, number, string][] = [
      ['quota', 429, 'quota'],
      ['auth-fail', 503, 'not-logged-in'],
      ['garbage', 502, 'cli-failed'],
      ['no-structured', 502, 'bad-response'],
      ['huge', 502, 'output-too-large'],
    ];
    for (const [mode, status, code] of expectations) {
      setState({ mode });
      const response = await request('/v1/suggest', { body: { brief: brief() } });
      const body = await response.json();
      expect([mode, response.status, body.error.code]).toEqual([mode, status, code]);
      expect(JSON.stringify(body)).not.toMatch(/sk-secret|token=|stderr/);
    }
    // The detail stays in the operator's own terminal log.
    expect(logLines.join('\n')).toMatch(/claude exited with code 1/);

    setState({ output: { suggestionsVersion: 1, suggestions: [{ ...GOOD, title: '<script>alert(1)</script>' }] } });
    const hostile = await request('/v1/suggest', { body: { brief: brief() } });
    expect(hostile.status).toBe(502);
    expect((await hostile.json()).error.code).toBe('bad-response');
  });

  it('times out a hung CLI and stays usable afterwards', async () => {
    await start({ requestTimeoutMs: 400 });
    setState({ mode: 'hang' });
    const started = Date.now();
    const response = await request('/v1/suggest', { body: { brief: brief() } });
    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(5000);
    setState({});
    expect((await request('/v1/suggest', { body: { brief: brief() } })).status).toBe(200);
  });

  it('allows one request at a time and cancels the CLI when the client goes away', async () => {
    await start({ requestTimeoutMs: 30_000 });
    setState({ mode: 'hang' });
    const controller = new AbortController();
    const first = request('/v1/suggest', { body: { brief: brief() }, signal: controller.signal }).catch((error: Error) => error);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const second = await request('/v1/suggest', { body: { brief: brief() } });
    expect(second.status).toBe(429);
    expect((await second.json()).error.code).toBe('busy');

    controller.abort();
    expect(((await first) as Error).name).toBe('AbortError');
    // The hung child is killed, so the bridge frees up well before its 30 s timeout.
    setState({});
    let status = 0;
    for (let i = 0; i < 40 && status !== 200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      status = (await request('/v1/suggest', { body: { brief: brief() } })).status;
    }
    expect(status).toBe(200);
  });
});
