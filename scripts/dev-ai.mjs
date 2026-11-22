// Runs the app and the optional Claude Code bridge together: `npm run dev:ai`.
import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['bridge/main.ts'], { stdio: 'inherit' }),
];
const stop = () => children.forEach((child) => child.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((child) => child.on('exit', () => stop()));
