// Runs a TypeScript script through Vite's module runner, so scripts can import
// the application's source (including the vendored encoder) without a build.
// Usage: node scripts/run.mjs <script.ts> [args...]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runnerImport } from 'vite';

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error('Usage: node scripts/run.mjs <script.ts> [args...]');
  process.exit(1);
}
process.argv = [process.argv[0], resolve(script), ...args];
const { module } = await runnerImport(pathToFileURL(resolve(script)).href, { configFile: false, logLevel: 'error' });
if (typeof module.default === 'function') await module.default(args);
