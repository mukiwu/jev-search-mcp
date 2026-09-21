import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startFakeJev } from './helpers/fake-jev.js';

const run = promisify(execFile);
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

let fake;
before(async () => {
  fake = await startFakeJev();
});
after(async () => {
  await fake?.close();
});

function cli(args, env = {}) {
  return run(process.execPath, [cliPath, ...args], {
    env: { ...process.env, JEV_SEARCH_BASE_URL: fake.baseUrl, ...env },
  }).catch((err) => ({ stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code }));
}

test('search prints the formatted results and exits 0', async () => {
  const { stdout, code } = await cli(['search', 'hello there', '--max', '2']);
  assert.equal(code, undefined);
  assert.match(stdout, /^Query: hello there/);
  assert.match(stdout, /1\. \[90%\]/);
  assert.doesNotMatch(stdout, /3\. \[70%\]/);
});

test('search passes --window and --sources through', async () => {
  await cli(['search', 'scoped', '--window', '30d', '--sources', 'github,arxiv']);
  assert.deepEqual(fake.requests.at(-1).body, { q: 'scoped', w: '30d', s: ['github', 'arxiv'] });
});

test('search --json prints machine-readable output', async () => {
  const { stdout } = await cli(['search', 'hello', '--json']);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.intent.query, 'hello');
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.items[0].url, 'https://fake.example/1');
});

test('search on an upstream error writes to stderr and exits non-zero', async () => {
  const { stderr, code } = await cli(['search', 'please ratelimit me']);
  assert.equal(code, 1);
  assert.match(stderr, /429/);
});

test('search without a request explains usage and exits 2', async () => {
  const { stderr, code } = await cli(['search']);
  assert.equal(code, 2);
  assert.match(stderr, /search/i);
});

test('--help prints usage covering both modes', async () => {
  const { stdout, code } = await cli(['--help']);
  assert.equal(code, undefined);
  assert.match(stdout, /serve/);
  assert.match(stdout, /search/);
  assert.match(stdout, /JEV_SEARCH_BASE_URL/);
});
