/**
 * Loopback HTTP server between the QR Studio page and the local Claude Code CLI.
 * Personal and local by design: it binds to 127.0.0.1, accepts only the exact
 * origins it was started for, and requires the per-session pairing token.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { DesignBriefSchema } from '../src/ai/brief.ts';
import { CliError, inspectCli, requestSuggestions, type CliErrorCode, type CliInspection } from './claude-cli.ts';
import type { BridgeConfig } from './config.ts';

export interface BridgeDeps {
  config: BridgeConfig;
  /** Per-session secret. Printed in the operator's terminal as the pairing code. */
  token: string;
  env: Record<string, string | undefined>;
  /** Empty working directory for the CLI. */
  cwd: string;
  log?: (line: string) => void;
  /** Injection points for tests. */
  inspect?: typeof inspectCli;
  suggest?: typeof requestSuggestions;
}

const RequestSchema = z.strictObject({ brief: DesignBriefSchema });
const INSPECTION_TTL_MS = 30_000;

const STATUS_FOR: Record<CliErrorCode, number> = {
  'cli-missing': 503,
  'cli-unsupported': 503,
  'not-logged-in': 503,
  'wrong-auth': 503,
  quota: 429,
  timeout: 504,
  cancelled: 499,
  'output-too-large': 502,
  'bad-response': 502,
  'cli-failed': 502,
};

function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function createBridgeServer(deps: BridgeDeps): Server {
  const { config, token } = deps;
  const log = deps.log ?? (() => undefined);
  const inspect = deps.inspect ?? inspectCli;
  const suggest = deps.suggest ?? requestSuggestions;
  const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  const allowedOrigins = new Set(config.allowedOrigins);
  let cached: { at: number; value: CliInspection } | null = null;
  let busy = false;

  const inspection = async (): Promise<CliInspection> => {
    if (cached && Date.now() - cached.at < INSPECTION_TTL_MS) return cached.value;
    const value = await inspect(config, deps.env, deps.cwd);
    cached = { at: Date.now(), value };
    return value;
  };

  const send = (res: ServerResponse, status: number, body: unknown, origin: string | null) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers.Vary = 'Origin';
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };
  const fail = (res: ServerResponse, status: number, code: string, message: string, origin: string | null) => send(res, status, { error: { code, message } }, origin);

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > config.maxRequestBytes) {
          reject(new Error('too-large'));
          req.destroy();
        } else chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  return createServer((req, res) => {
    void (async () => {
      // 1. Exact Host: defeats DNS rebinding, where a hostile page reaches loopback under its own name.
      if (!req.headers.host || !allowedHosts.has(req.headers.host)) return fail(res, 403, 'bad-host', 'Unexpected Host header.', null);
      // 2. Exact Origin: only the QR Studio page this bridge was started for.
      const originHeader = req.headers.origin;
      if (typeof originHeader !== 'string' || !allowedOrigins.has(originHeader)) return fail(res, 403, 'bad-origin', 'This origin is not allowed to use the bridge.', null);
      const origin = originHeader;
      const path = (req.url ?? '').split('?')[0];

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        });
        res.end();
        return;
      }

      // 3. Per-session token.
      const authorization = req.headers.authorization ?? '';
      const presented = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!presented || !sameSecret(presented, token)) return fail(res, 401, 'unauthorized', 'Missing or wrong pairing code. Pair again with the code printed by the bridge.', origin);

      if (req.method === 'GET' && path === '/v1/status') {
        const state = await inspection();
        // Only what the UI needs: no paths, account names or environment values.
        return send(res, 200, { ready: state.ready, reason: state.reason, cliVersion: state.version, authMethod: state.authMethod, subscription: state.subscription, model: config.model }, origin);
      }

      if (req.method === 'POST' && path === '/v1/suggest') {
        if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return fail(res, 415, 'bad-content-type', 'Send application/json.', origin);
        let text: string;
        try {
          text = await readBody(req);
        } catch {
          return fail(res, 413, 'too-large', 'The design brief is larger than the bridge accepts.', origin);
        }
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          return fail(res, 400, 'bad-json', 'The request body is not valid JSON.', origin);
        }
        // The only accepted input is a design brief. There is no field for a command, flag, path or model.
        const parsed = RequestSchema.safeParse(raw);
        if (!parsed.success) return fail(res, 400, 'bad-brief', 'The request is not a valid design brief.', origin);

        if (busy) return fail(res, 429, 'busy', 'Another suggestion request is still running.', origin);
        busy = true;
        const controller = new AbortController();
        const onClose = () => {
          if (!res.writableEnded) controller.abort();
        };
        res.on('close', onClose);
        try {
          const state = await inspection();
          if (!state.ready) return fail(res, 503, 'unavailable', state.reason ?? 'Claude Code is not available.', origin);
          const result = await suggest(parsed.data.brief, state, config, deps.env, deps.cwd, controller.signal, log);
          log(`suggestions returned in ${result.durationMs} ms`);
          return send(res, 200, { result: result.suggestions }, origin);
        } catch (error) {
          if (error instanceof CliError) {
            // A changed login state should be re-checked on the next request.
            if (error.code === 'not-logged-in') cached = null;
            if (res.destroyed) return;
            return fail(res, STATUS_FOR[error.code], error.code, error.message, origin);
          }
          log(`unexpected bridge error: ${error instanceof Error ? error.message : String(error)}`);
          return fail(res, 500, 'internal', 'The bridge hit an unexpected error.', origin);
        } finally {
          busy = false;
          res.off('close', onClose);
        }
      }

      return fail(res, 404, 'not-found', 'Unknown bridge endpoint.', origin);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}
