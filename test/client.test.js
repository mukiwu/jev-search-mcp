import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askJev } from '../src/client.js';

const INTENT = {
  type: 'intent',
  request: 'rust async runtimes',
  query: 'rust async runtimes',
  entityQuery: 'rust async runtimes',
  candidates: ['rust async runtimes'],
  window: '30d',
  sources: ['google', 'hackernews'],
  inferred: {},
  intentMs: 400,
  judge: 'vercel',
};

function lane(source, engine, items, extra = {}) {
  return { type: 'lane', source, engine, items, stale: 0, searchMs: 1000, scoreMs: 300, ...extra };
}

function row(source, engine, n, url, relevance) {
  return {
    id: `${source}:${engine}:${n}`,
    source,
    title: `Title ${n}`,
    url,
    snippet: `Snippet ${n}`,
    ageHours: null,
    relevance,
    ranked: true,
    freshness: 0.5,
    position: n,
    engines: [engine],
  };
}

/** Streams the given events as NDJSON, splitting the bytes at arbitrary offsets to exercise buffering. */
function streamingResponse(events, { chunkSize = 7, status = 200, contentType = 'application/x-ndjson' } = {}) {
  const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': contentType } });
}

test('askJev posts to /api/ask with a same-origin header and the q/w/s body', async () => {
  let seen;
  const fetch = async (url, init) => {
    seen = { url, init };
    return streamingResponse([INTENT, { type: 'done', totalMs: 1500, tokens: 100 }]);
  };
  await askJev({ baseUrl: 'https://jev.example.test/', query: '  rust async runtimes ', window: '7d', sources: ['hackernews'] }, { fetch });
  assert.equal(seen.url, 'https://jev.example.test/api/ask');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Origin, 'https://jev.example.test');
  assert.equal(seen.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(seen.init.body), { q: 'rust async runtimes', w: '7d', s: ['hackernews'] });
});

test('askJev omits w and s when the caller leaves the choice to Jev', async () => {
  let body;
  const fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return streamingResponse([INTENT, { type: 'done', totalMs: 1, tokens: 1 }]);
  };
  await askJev({ baseUrl: 'https://jev.example.test', query: 'x' }, { fetch });
  assert.deepEqual(body, { q: 'x' });
});

test('askJev reassembles events split across chunks and folds lanes by url', async () => {
  const events = [
    INTENT,
    { type: 'found', source: 'google', engine: 'google', items: [], searchMs: 1 },
    lane('google', 'google', [
      row('google', 'google', 1, 'https://a.com/x', 0.9),
      row('google', 'google', 2, 'https://b.com/', 0.4),
    ]),
    lane('hackernews', 'google', [row('hackernews', 'google', 1, 'https://www.a.com/x/', 0.7)]),
    lane('hackernews', 'hackernews', [], { error: 'HTTP 504' }),
    { type: 'done', totalMs: 4200, tokens: 999 },
  ];
  const result = await askJev({ baseUrl: 'https://jev.example.test', query: 'q' }, { fetch: async () => streamingResponse(events, { chunkSize: 5 }) });

  assert.equal(result.intent.judge, 'vercel');
  assert.deepEqual(result.intent.sources, ['google', 'hackernews']);
  assert.equal(result.items.length, 2, 'a.com/x from two lanes is one row');
  const a = result.items.find((i) => i.url.includes('a.com'));
  assert.deepEqual(a.engines, ['google']);
  assert.equal(a.relevance, 0.9);
  assert.deepEqual(result.errors, [{ source: 'hackernews', engine: 'hackernews', message: 'HTTP 504' }]);
  assert.equal(result.totalMs, 4200);
  assert.equal(result.lanes.length, 3);
});

test('askJev surfaces an HTTP error body as a readable error', async () => {
  const fetch = async () => new Response(JSON.stringify({ error: 'Too many searches from this address. Try again in a minute.' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(
    askJev({ baseUrl: 'https://jev.example.test', query: 'q' }, { fetch }),
    (err) => err.message.includes('429') && err.message.includes('Too many searches')
  );
});

test('askJev throws when the stream reports an error before any intent', async () => {
  const fetch = async () => streamingResponse([{ type: 'error', message: 'Missing configuration' }]);
  await assert.rejects(askJev({ baseUrl: 'https://jev.example.test', query: 'q' }, { fetch }), /Missing configuration/);
});

test('askJev keeps partial results when the stream errors after lanes arrived', async () => {
  const events = [
    INTENT,
    lane('google', 'google', [row('google', 'google', 1, 'https://a.com', 0.8)]),
    { type: 'error', message: 'stream cut' },
  ];
  const result = await askJev({ baseUrl: 'https://jev.example.test', query: 'q' }, { fetch: async () => streamingResponse(events) });
  assert.equal(result.items.length, 1);
  assert.equal(result.streamError, 'stream cut');
});

test('askJev rejects an empty query before touching the network', async () => {
  let called = false;
  await assert.rejects(askJev({ baseUrl: 'https://jev.example.test', query: '   ' }, { fetch: async () => { called = true; } }), /query/i);
  assert.equal(called, false);
});

test('askJev trims an over-long query to the 300-char API limit and reports it', async () => {
  let body;
  const fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return streamingResponse([INTENT, { type: 'done', totalMs: 1, tokens: 1 }]);
  };
  const long = 'word '.repeat(80).trim(); // 399 chars
  const result = await askJev({ baseUrl: 'https://jev.example.test', query: long }, { fetch });
  assert.ok(body.q.length <= 300);
  assert.equal(result.truncatedQuery, true);
});
