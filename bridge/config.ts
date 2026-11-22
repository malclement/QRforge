/** Bridge configuration. Everything comes from the operator's environment at start-up; nothing from HTTP. */
export interface BridgeConfig {
  port: number;
  /** Browser origins allowed to call the bridge, matched exactly. */
  allowedOrigins: string[];
  /** Absolute path of the Claude Code binary, or null to search PATH. */
  claudeBin: string | null;
  /** Optional model alias or id passed to the CLI. Null leaves the user's default. */
  model: string | null;
  requestTimeoutMs: number;
  maxRequestBytes: number;
  maxOutputBytes: number;
}

export const DEFAULT_PORT = 4317;
const DEFAULT_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173'];

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined>): BridgeConfig {
  const port = env.QRSTUDIO_BRIDGE_PORT ? Number(env.QRSTUDIO_BRIDGE_PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new ConfigError('QRSTUDIO_BRIDGE_PORT must be an integer between 1024 and 65535.');

  const allowedOrigins = env.QRSTUDIO_ALLOWED_ORIGINS ? env.QRSTUDIO_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) : DEFAULT_ORIGINS;
  for (const origin of allowedOrigins) {
    // Only loopback origins make sense: this bridge is for the person at this computer.
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(origin)) throw new ConfigError(`QRSTUDIO_ALLOWED_ORIGINS may only list http://127.0.0.1:<port> or http://localhost:<port>; got "${origin}".`);
  }

  const model = env.QRSTUDIO_CLAUDE_MODEL?.trim() || null;
  if (model && !/^[A-Za-z0-9][A-Za-z0-9._\-[\]]{0,63}$/.test(model)) throw new ConfigError('QRSTUDIO_CLAUDE_MODEL is not a valid model name.');

  const claudeBin = env.QRSTUDIO_CLAUDE_BIN?.trim() || null;
  if (claudeBin && !claudeBin.startsWith('/')) throw new ConfigError('QRSTUDIO_CLAUDE_BIN must be an absolute path.');

  return { port, allowedOrigins, claudeBin, model, requestTimeoutMs: 120_000, maxRequestBytes: 16 * 1024, maxOutputBytes: 1024 * 1024 };
}
