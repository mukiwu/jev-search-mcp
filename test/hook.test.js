// Exercises hooks/jev.js the way the engine would, with a fake `$`, `e` and `next`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_BLOCK_NAME, readOptions, register } from '../hooks/jev.js';
import { CANNED_EVENTS } from './helpers/fake-jev.js';

const NDJSON = CANNED_EVENTS.map((e) => JSON.stringify(e)).join('\n') + '\n';

function harness({ fetchImpl, options } = {}) {
  const hooks = new Map();
  const logs = [];
  const statuses = [];
  const toasts = [];
  const calls = [];
  const on = (event, matcherOrHook, maybeHook) => {
    const matcher = maybeHook ? matcherOrHook : undefined;
    const hook = maybeHook ?? matcherOrHook;
    const key = matcher?.tool ? `${event}:${matcher.tool}` : event;
    hooks.set(key, { matcher, hook });
    return { catch: () => {} };
  };
  register(on, options ?? {});
  const $ = {
    http: {
      fetch: async (url, init) => {
        calls.push({ url, init });
        return fetchImpl ? fetchImpl(url, init) : { status: 200, ok: true, headers: {}, text: NDJSON };
      },
    },
    ui: {
      log: (text, opts) => logs.push({ text, opts }),
      status: (text) => statuses.push(text),
      toast: (text) => toasts.push(text),
    },
  };
  let nextCalls = 0;
  const next = Object.assign(
    async (e) => {
      nextCalls += 1;
      return { ref: 'core', result: { query: e.query, results: ['core answered'], durationSeconds: 0 } };
    },
    { signal: new AbortController().signal }
  );
  return { hooks, $, next, logs, statuses, toasts, calls, nextCalls: () => nextCalls };
}

const CALL = { tool: 'WebSearch', tool_use_id: 'toolu_42', query: 'hello world' };

test('register hooks WebSearch on tool.call and tool.describe, and prompt.context without a matcher', () => {
  const { hooks } = harness();
  assert.deepEqual(hooks.get('tool.call:WebSearch').matcher, { tool: 'WebSearch' });
  assert.deepEqual(hooks.get('tool.describe:WebSearch').matcher, { tool: 'WebSearch' });
  assert.equal(hooks.get('prompt.context').matcher, undefined);
  assert.equal(hooks.has('tool.call:Bash'), false, 'Bash is left alone');
});

test('prompt.context appends the plugin guidance block after the engine blocks, once', async () => {
  const h = harness();
  const e = { blocks: [{ name: 'claudeMd', text: 'rules' }, { name: 'currentDate', text: '2026-09-21' }] };
  let passed;
  const next = async (x) => {
    passed = x;
    return { blocks: x.blocks };
  };
  const out = await h.hooks.get('prompt.context').hook(h.$, e, next);
  assert.deepEqual(passed.blocks.map((b) => b.name), ['claudeMd', 'currentDate', CONTEXT_BLOCK_NAME]);
  assert.match(passed.blocks.at(-1).text, /call WebSearch first/);
  assert.match(passed.blocks.at(-1).text, /proper API, querying that API directly is the better tool/);
  assert.equal(out.blocks.length, 3);
  const again = await h.hooks.get('prompt.context').hook(h.$, { blocks: passed.blocks }, next);
  assert.equal(again.blocks.filter((b) => b.name === CONTEXT_BLOCK_NAME).length, 1, 'no duplicate block on a re-read');
});

test('prompt.context leaves the blocks alone when intercept is off', async () => {
  const h = harness({ options: { intercept: false } });
  const e = { blocks: [{ name: 'claudeMd', text: 'rules' }] };
  let passed;
  await h.hooks.get('prompt.context').hook(h.$, e, async (x) => {
    passed = x;
    return { blocks: x.blocks };
  });
  assert.deepEqual(passed.blocks.map((b) => b.name), ['claudeMd']);
});

test('tool.call answers with a WebSearch-shaped result from Jev and never calls next', async () => {
  const h = harness();
  const out = await h.hooks.get('tool.call:WebSearch').hook(h.$, CALL, h.next);
  assert.equal(h.nextCalls(), 0);
  assert.equal(out.result.query, 'hello world');
  assert.equal(out.result.results[0].tool_use_id, 'toolu_42');
  assert.equal(out.result.results[0].content.length, 3);
  assert.match(out.result.results[1], /Answered by Jev Search/);
  assert.equal(typeof out.result.durationSeconds, 'number');
  const sent = h.calls[0];
  assert.equal(sent.url, 'https://jev.s1.dev/api/ask');
  assert.equal(sent.init.headers.Origin, 'https://jev.s1.dev');
  assert.deepEqual(JSON.parse(sent.init.body), { q: 'hello world' });
  assert.deepEqual(h.statuses, ['Jev Search…', undefined]);
  assert.deepEqual(h.toasts, ['Jev Search: 3 results via google, duckduckgo in 1.2s']);
});

test('tool.call forwards allowed domains as sources and filters blocked ones', async () => {
  const h = harness();
  await h.hooks.get('tool.call:WebSearch').hook(h.$, { ...CALL, allowed_domains: ['reddit.com'] }, h.next);
  assert.deepEqual(JSON.parse(h.calls[0].init.body), { q: 'hello world', s: ['reddit'] });
});

test('tool.call falls back to the built-in tool when Jev returns an error status', async () => {
  const h = harness({ fetchImpl: async () => ({ status: 429, ok: false, headers: {}, text: JSON.stringify({ error: 'Too many searches' }) }) });
  const out = await h.hooks.get('tool.call:WebSearch').hook(h.$, CALL, h.next);
  assert.equal(h.nextCalls(), 1);
  assert.deepEqual(out.result.results, ['core answered']);
  assert.match(h.logs.at(-1).text, /unavailable.*429.*Too many searches/);
  assert.equal(h.logs.at(-1).opts, undefined, 'the fallback notice goes to the transcript');
  assert.deepEqual(h.toasts, [], 'no success toast on a fallback');
});

test('tool.call falls back when the network throws', async () => {
  const h = harness({
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  const out = await h.hooks.get('tool.call:WebSearch').hook(h.$, CALL, h.next);
  assert.equal(h.nextCalls(), 1);
  assert.deepEqual(out.result.results, ['core answered']);
});

test('tool.call falls back when the domain filter leaves nothing', async () => {
  const h = harness();
  await h.hooks.get('tool.call:WebSearch').hook(h.$, { ...CALL, allowed_domains: ['nowhere.example'] }, h.next);
  assert.equal(h.nextCalls(), 1);
});

test('tool.call passes straight through when intercept is off', async () => {
  const h = harness({ options: { intercept: false } });
  await h.hooks.get('tool.call:WebSearch').hook(h.$, CALL, h.next);
  assert.equal(h.nextCalls(), 1);
  assert.equal(h.calls.length, 0);
});

test('tool.call honours a custom base url and maxResults from options', async () => {
  const h = harness({ options: { baseUrl: 'http://localhost:3030/', maxResults: 1 } });
  const out = await h.hooks.get('tool.call:WebSearch').hook(h.$, CALL, h.next);
  assert.equal(h.calls[0].url, 'http://localhost:3030/api/ask');
  assert.equal(out.result.results[0].content.length, 1);
});

test('tool.describe appends the Jev guidance to WebSearch', async () => {
  const h = harness();
  const e = { tool: 'WebSearch', description: 'Search the web.', provider: { plugin: 'engine', tier: 'core' } };
  const out = await h.hooks.get('tool.describe:WebSearch').hook(h.$, e, h.next);
  assert.match(out.description, /^Search the web\./);
  assert.match(out.description, /Jev Search/);
});

test('readOptions fills defaults and tolerates stringly values', () => {
  assert.deepEqual(readOptions({}), { baseUrl: 'https://jev.s1.dev', intercept: true, maxResults: 10 });
  assert.deepEqual(readOptions({ baseUrl: ' https://jev.example ', intercept: 'true', maxResults: '5' }), {
    baseUrl: 'https://jev.example',
    intercept: true,
    maxResults: 5,
  });
  assert.equal(readOptions({ maxResults: 999 }).maxResults, 10);
});
