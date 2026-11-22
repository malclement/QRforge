#!/usr/bin/env node
// Test double for the Claude Code CLI. Behaviour is chosen by the file named
// in FAKE_CLAUDE_STATE (the bridge's environment allowlist would drop a plain
// variable, which is itself part of what the tests check), and every
// invocation is appended to a log so tests can assert on argv, stdin and env.
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const stateFile = join(dirname(fileURLToPath(import.meta.url)), '.fake-claude-state.json');
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const args = process.argv.slice(2);

let stdin = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) stdin += chunk;
appendFileSync(state.log, JSON.stringify({ args, stdin, cwd: process.cwd(), env: process.env }) + '\n');

if (args[0] === '--version') {
  console.log(`${state.version ?? '9.9.9'} (Claude Code)`);
} else if (args[0] === '--help') {
  const flags = state.flags ?? ['-p, --print', '--output-format <format>', '--json-schema <schema>', '--system-prompt <prompt>', '--safe-mode', '--tools <tools...>', '--strict-mcp-config', '--disallowedTools, --disallowed-tools <tools...>', '--permission-prompts <target>', '--no-session-persistence', '--disable-slash-commands'];
  console.log('Usage: claude [options]\n\nOptions:\n' + flags.map((f) => `  ${f}   description`).join('\n'));
} else if (args[0] === 'auth') {
  console.log(JSON.stringify(state.auth ?? { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max', email: 'person@example.com' }));
} else {
  const mode = state.mode ?? 'ok';
  if (mode === 'hang') {
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  } else if (mode === 'huge') {
    process.stdout.write('x'.repeat(3 * 1024 * 1024));
  } else if (mode === 'garbage') {
    console.log('this is not json');
  } else if (mode === 'quota') {
    console.error('API Error: usage limit reached for this plan');
    console.log(JSON.stringify({ type: 'result', is_error: true, result: 'Usage limit reached' }));
    process.exit(1);
  } else if (mode === 'auth-fail') {
    console.error('Not logged in. Please run /login. token=sk-secret-should-never-leak');
    process.exit(1);
  } else if (mode === 'no-structured') {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'I cannot help with that.' }));
  } else {
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: state.output, total_cost_usd: 0 }));
  }
}
