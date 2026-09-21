import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateArgs, readConfig } from '../src/tool.js';

test('validateArgs accepts a plain query and leaves optional fields absent', () => {
  const out = validateArgs({ query: 'hi' });
  assert.deepEqual(out, { query: 'hi' });
});

test('validateArgs rejects a missing or blank query', () => {
  assert.throws(() => validateArgs({}), /query/);
  assert.throws(() => validateArgs({ query: '   ' }), /query/);
  assert.throws(() => validateArgs(null), /query/);
});

test('validateArgs checks window, sources and max_results against their domains', () => {
  assert.throws(() => validateArgs({ query: 'q', window: 'yesterday' }), /window/);
  assert.throws(() => validateArgs({ query: 'q', sources: ['bing'] }), /sources/);
  assert.throws(() => validateArgs({ query: 'q', sources: 'github' }), /sources/);
  assert.throws(() => validateArgs({ query: 'q', max_results: 0 }), /max_results/);
  assert.throws(() => validateArgs({ query: 'q', max_results: 2.5 }), /max_results/);
  assert.throws(() => validateArgs({ query: 'q', max_results: 999 }), /max_results/);
  assert.deepEqual(validateArgs({ query: 'q', window: '7d', sources: ['github'], max_results: 3 }), {
    query: 'q',
    window: '7d',
    sources: ['github'],
    max_results: 3,
  });
});

test('readConfig falls back to the hosted instance and sane numbers', () => {
  assert.deepEqual(readConfig({}), { baseUrl: 'https://jev.s1.dev', timeoutMs: 35000, defaultMaxResults: 10 });
  assert.deepEqual(readConfig({ JEV_SEARCH_BASE_URL: ' http://localhost:3030/ ', JEV_SEARCH_TIMEOUT_MS: '5000', JEV_SEARCH_MAX_RESULTS: '3' }), {
    baseUrl: 'http://localhost:3030/',
    timeoutMs: 5000,
    defaultMaxResults: 3,
  });
  assert.equal(readConfig({ JEV_SEARCH_TIMEOUT_MS: 'abc' }).timeoutMs, 35000);
});
