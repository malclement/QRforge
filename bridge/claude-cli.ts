/**
 * Constrained adapter around the user's own, unmodified Claude Code CLI.
 *
 * What it guarantees:
 * - The binary is started with an argument array and no shell. The design
 *   brief reaches it on stdin only; nothing from a request becomes an argument.
 * - The child gets an allowlisted environment, so an API key that happens to be
 *   exported in the operator's shell is not inherited and cannot change who is
 *   billed. Authentication is whatever `claude auth status` reports for that
 *   environment; anything other than a Claude subscription login disables the
 *   bridge instead of falling back.
 * - Customizations (CLAUDE.md, hooks, plugins, MCP servers, skills) are off via
 *   safe mode, built-in tools are off, MCP tools are denied, and permission
 *   prompts are answered "no". Safe mode keeps native authentication; bare
 *   mode is not used because it would bypass the subscription login.
 * - Runs in an empty temporary directory, with bounded time and output.
 *
 * These are CLI flags, not an operating-system sandbox. Managed (policy)
 * settings still apply, as they should.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { DesignBrief } from '../src/ai/brief.ts';
import { SYSTEM_PROMPT, userPrompt } from '../src/ai/prompt.ts';
import { suggestionsJsonSchema, SuggestionsSchema, type Suggestions } from '../src/ai/suggestions.ts';
import type { BridgeConfig } from './config.ts';

/** Flags the adapter cannot work safely without. Checked against `claude --help`. */
const REQUIRED_FLAGS = ['--print', '--output-format', '--json-schema', '--system-prompt', '--safe-mode', '--tools', '--strict-mcp-config', '--disallowedTools', '--permission-prompts'];
/** Used when the installed version offers them. */
const OPTIONAL_FLAGS = ['--disable-slash-commands', '--no-session-persistence'];

/** Environment variables passed through to the CLI. Everything else is dropped. */
const ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TERM', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'CLAUDE_CONFIG_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'];

export type CliErrorCode = 'cli-missing' | 'cli-unsupported' | 'not-logged-in' | 'wrong-auth' | 'quota' | 'timeout' | 'cancelled' | 'output-too-large' | 'bad-response' | 'cli-failed';

export class CliError extends Error {
  readonly code: CliErrorCode;
  constructor(code: CliErrorCode, message: string) {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}

export interface CliInspection {
  ready: boolean;
  reason: string | null;
  bin: string | null;
  version: string | null;
  authMethod: string | null;
  subscription: string | null;
  optionalFlags: string[];
}

export function childEnvironment(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = env[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export function findBinary(config: Pick<BridgeConfig, 'claudeBin'>, env: Record<string, string | undefined>): string | null {
  const candidates = config.claudeBin ? [config.claudeBin] : (env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude'));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

interface RunOptions {
  cwd: string;
  env: Record<string, string>;
  input?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run the binary with an argument array. `shell` is never enabled. */
function run(bin: string, args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new CliError('cancelled', 'The request was cancelled.'));
      return;
    }
    const child = spawn(bin, args, { cwd: options.cwd, env: options.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let failure: CliError | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const stop = (error: CliError) => {
      if (failure) return;
      failure = error;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    };
    const timer = setTimeout(() => stop(new CliError('timeout', `Claude Code did not answer within ${Math.round(options.timeoutMs / 1000)} seconds.`)), options.timeoutMs);
    const onAbort = () => stop(new CliError('cancelled', 'The request was cancelled.'));
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > options.maxOutputBytes) stop(new CliError('output-too-large', 'Claude Code produced more output than the bridge accepts.'));
      else stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 16_384) stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(failure ?? new CliError('cli-failed', `Claude Code could not be started (${(error as NodeJS.ErrnoException).code ?? 'error'}).`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
      if (failure) reject(failure);
      else resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => undefined); // the child may exit before reading
    child.stdin.end(options.input ?? '');
  });
}

/** Version, supported flags and effective authentication, using only public CLI commands. */
export async function inspectCli(config: BridgeConfig, env: Record<string, string | undefined>, cwd: string): Promise<CliInspection> {
  const base: CliInspection = { ready: false, reason: null, bin: null, version: null, authMethod: null, subscription: null, optionalFlags: [] };
  const bin = findBinary(config, env);
  if (!bin) return { ...base, reason: 'Claude Code was not found on PATH. Install it, or set QRSTUDIO_CLAUDE_BIN to its absolute path.' };
  const options = { cwd, env: childEnvironment(env), timeoutMs: 20_000, maxOutputBytes: 512 * 1024 };
  try {
    const version = await run(bin, ['--version'], options);
    const versionText = /\d+\.\d+\.\d+/.exec(version.stdout)?.[0] ?? null;
    if (version.code !== 0 || !versionText) return { ...base, bin, reason: 'The Claude Code binary did not report a version.' };

    const help = await run(bin, ['--help'], options);
    const has = (flag: string) => new RegExp(`(^|[\\s,])${flag.replace(/-/g, '\\-')}(?![\\w-])`, 'm').test(help.stdout);
    const missing = REQUIRED_FLAGS.filter((flag) => !has(flag));
    if (missing.length > 0) {
      return { ...base, bin, version: versionText, reason: `Claude Code ${versionText} does not offer ${missing.join(', ')}, which this bridge needs to run it safely. Update Claude Code, or use the manual hand-off.` };
    }

    const auth = await run(bin, ['auth', 'status', '--json'], options);
    let status: { loggedIn?: unknown; authMethod?: unknown; apiProvider?: unknown; subscriptionType?: unknown };
    try {
      status = JSON.parse(auth.stdout) as typeof status;
    } catch {
      return { ...base, bin, version: versionText, reason: 'Could not read the authentication status from Claude Code.' };
    }
    const authMethod = typeof status.authMethod === 'string' ? status.authMethod : null;
    const subscription = typeof status.subscriptionType === 'string' ? status.subscriptionType : null;
    const details = { ...base, bin, version: versionText, authMethod, subscription, optionalFlags: OPTIONAL_FLAGS.filter(has) };
    if (status.loggedIn !== true) return { ...details, reason: 'Claude Code is not signed in. Run "claude" in a terminal and sign in with your Claude account.' };
    if (authMethod !== 'claude.ai' || status.apiProvider !== 'firstParty') {
      return {
        ...details,
        reason: `Claude Code is authenticated with "${authMethod ?? 'an unknown method'}", not a Claude subscription login. This bridge only uses a subscription login and does not switch to other billing. Use the manual hand-off instead.`,
      };
    }
    return { ...details, ready: true };
  } catch (error) {
    return { ...base, bin, reason: error instanceof CliError ? error.message : 'Claude Code could not be inspected.' };
  }
}

/** Fixed arguments. Request data never appears here. */
export function buildArguments(inspection: Pick<CliInspection, 'optionalFlags'>, model: string | null): string[] {
  const args = [
    '--print',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(suggestionsJsonSchema()),
    '--system-prompt', SYSTEM_PROMPT,
    '--safe-mode',
    '--tools', '',
    '--strict-mcp-config',
    '--disallowedTools', 'mcp__*',
    '--permission-prompts', 'none',
  ];
  for (const flag of inspection.optionalFlags) args.push(flag);
  if (model) args.push('--model', model);
  return args;
}

function classifyFailure(text: string): CliError {
  const lower = text.toLowerCase();
  if (/usage limit|rate limit|rate_limit|quota|overloaded|billing/.test(lower)) return new CliError('quota', 'Claude reported a usage or rate limit. Wait and try again; the bridge does not retry on its own.');
  if (/not logged in|\/login|authentication|unauthorized|oauth|401|403/.test(lower)) return new CliError('not-logged-in', 'Claude Code could not authenticate. Sign in again by running "claude" in a terminal.');
  return new CliError('cli-failed', 'Claude Code did not complete the request. See the bridge terminal for details.');
}

export interface SuggestionRun {
  suggestions: Suggestions;
  durationMs: number;
}

/** One model call: brief in on stdin, validated suggestions out. No retries. */
export async function requestSuggestions(
  brief: DesignBrief,
  inspection: CliInspection,
  config: BridgeConfig,
  env: Record<string, string | undefined>,
  cwd: string,
  signal?: AbortSignal,
  log: (line: string) => void = () => undefined,
): Promise<SuggestionRun> {
  if (!inspection.ready || !inspection.bin) throw new CliError('cli-unsupported', inspection.reason ?? 'Claude Code is not available.');
  const started = Date.now();
  const result = await run(inspection.bin, buildArguments(inspection, config.model), {
    cwd,
    env: childEnvironment(env),
    input: userPrompt(brief),
    timeoutMs: config.requestTimeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    signal,
  });

  type Envelope = { is_error?: unknown; result?: unknown; structured_output?: unknown };
  let envelope: Envelope | null = null;
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) envelope = parsed as Envelope;
  } catch {
    envelope = null;
  }
  if (result.code !== 0 || !envelope || envelope.is_error === true) {
    // Details stay in the operator's terminal; the browser gets a short, mapped message.
    log(`claude exited with code ${result.code}; stderr: ${result.stderr.slice(0, 600).trim() || '(empty)'}`);
    throw classifyFailure(`${result.stderr}\n${typeof envelope?.result === 'string' ? envelope.result : ''}`);
  }
  if (envelope.structured_output === undefined) {
    throw new CliError('bad-response', 'Claude answered without structured output (it may have declined the request). Nothing was applied.');
  }
  // The CLI validated against the JSON Schema; validate again with the application's own schema.
  const validated = SuggestionsSchema.safeParse(envelope.structured_output);
  if (!validated.success) throw new CliError('bad-response', 'Claude returned suggestions that do not match the recipe schema. Nothing was applied.');
  return { suggestions: validated.data, durationMs: Date.now() - started };
}
