/** Browser client for the optional local bridge. Core features never call this. */
import type { DesignBrief } from './brief.ts';

export interface BridgeConnection {
  /** e.g. http://127.0.0.1:4317 */
  url: string;
  token: string;
}

export interface BridgeStatus {
  ready: boolean;
  /** Why the bridge cannot be used, when `ready` is false. */
  reason: string | null;
  cliVersion: string | null;
  authMethod: string | null;
  subscription: string | null;
  model: string | null;
}

export class BridgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

const STORAGE_KEY = 'qrstudio.bridge';
export const DEFAULT_BRIDGE_PORT = 4317;

/** Accepts `port:token` (as printed by the bridge) or a bare token on the default port. */
export function parsePairingCode(code: string): BridgeConnection | null {
  const match = /^\s*(?:(\d{2,5}):)?([A-Za-z0-9_-]{32,128})\s*$/.exec(code);
  if (!match) return null;
  const port = match[1] ? Number(match[1]) : DEFAULT_BRIDGE_PORT;
  if (port < 1024 || port > 65535) return null;
  return { url: `http://127.0.0.1:${port}`, token: match[2] };
}

/** Read a pairing code from the URL fragment (`#bridge=port:token`), then remove it from the address bar. */
export function takePairingFromLocation(): BridgeConnection | null {
  const match = /[#&]bridge=([^&]+)/.exec(window.location.hash);
  if (!match) return null;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  const connection = parsePairingCode(decodeURIComponent(match[1]));
  if (connection) saveConnection(connection);
  return connection;
}

export function saveConnection(connection: BridgeConnection | null): void {
  try {
    if (connection) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Session storage may be unavailable; the connection then lasts for this page only.
  }
}

export function loadConnection(): BridgeConnection | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<BridgeConnection>;
    if (typeof value.url === 'string' && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(value.url) && typeof value.token === 'string') return { url: value.url, token: value.token };
  } catch {
    // fall through
  }
  return null;
}

async function call(connection: BridgeConnection, path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${connection.url}${path}`, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${connection.token}` },
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    throw new BridgeError('unreachable', 'The local bridge is not reachable. Start it with "npm run bridge" and pair again.');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body: handled below through the status code.
  }
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new BridgeError(error?.code ?? `http-${response.status}`, error?.message ?? `The bridge answered with status ${response.status}.`);
  }
  return body;
}

export async function getBridgeStatus(connection: BridgeConnection, signal?: AbortSignal): Promise<BridgeStatus> {
  return (await call(connection, '/v1/status', { method: 'GET', signal })) as BridgeStatus;
}

/** Returns the raw suggestions payload; the caller validates it with `validateSuggestions`. */
export async function requestSuggestions(connection: BridgeConnection, brief: DesignBrief, signal?: AbortSignal): Promise<unknown> {
  const body = (await call(connection, '/v1/suggest', { method: 'POST', body: JSON.stringify({ brief }), signal })) as { result?: unknown };
  return body.result;
}
