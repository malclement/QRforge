/**
 * Entry point: `npm run bridge`.
 * Starts the optional local bridge between QR Studio and your own Claude Code.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectCli } from './claude-cli.ts';
import { ConfigError, loadConfig } from './config.ts';
import { createBridgeServer } from './server.ts';

function main(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : error);
    process.exit(1);
  }

  const token = randomBytes(32).toString('base64url');
  // An empty, private directory: the CLI finds no project files or settings here.
  const cwd = mkdtempSync(join(tmpdir(), 'qrstudio-bridge-'));
  const cleanup = () => rmSync(cwd, { recursive: true, force: true });
  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => process.exit(0));

  const log = (line: string) => console.log(`[bridge] ${line}`);
  const server = createBridgeServer({ config, token, env: process.env, cwd, log });
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${config.port} is in use. Set QRSTUDIO_BRIDGE_PORT to another port.` : `Bridge error: ${error.message}`);
    process.exit(1);
  });

  // Loopback only. Never 0.0.0.0.
  server.listen(config.port, '127.0.0.1', () => {
    const pairing = `${config.port}:${token}`;
    console.log(`QR Studio bridge listening on http://127.0.0.1:${config.port} (this computer only)`);
    console.log(`Allowed origins: ${config.allowedOrigins.join(', ')}`);
    for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) {
      if (process.env[name]) console.log(`Note: ${name} is set in this shell. The bridge does not pass it to Claude Code.`);
    }
    void inspectCli(config, process.env, cwd).then((state) => {
      if (state.ready) console.log(`Claude Code ${state.version}, signed in with ${state.authMethod}${state.subscription ? ` (${state.subscription})` : ''}. Model: ${config.model ?? 'your default'}.`);
      else console.log(`Claude Code is not usable yet: ${state.reason}`);
      console.log('');
      console.log(`Pairing code:  ${pairing}`);
      console.log(`Or open:       ${config.allowedOrigins[0]}/#bridge=${encodeURIComponent(pairing)}`);
      console.log('');
      console.log('Requests reach Anthropic only when you press "Ask Claude for designs". Press Ctrl+C to stop.');
    });
  });
}

main();
