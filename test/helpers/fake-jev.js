// A stand-in for jev-search's POST /api/ask so protocol and CLI tests never touch the network.
import http from 'node:http';

export const CANNED_INTENT = {
  type: 'intent',
  request: 'hello',
  query: 'hello',
  entityQuery: 'hello',
  candidates: ['hello'],
  window: 'any',
  sources: ['google', 'duckduckgo'],
  inferred: {},
  intentMs: 120,
  judge: 'typesafe',
};

function row(n, relevance) {
  return {
    id: `google:google:${n}`,
    source: 'google',
    title: `Fake result ${n}`,
    url: `https://fake.example/${n}`,
    snippet: `Snippet for result ${n}`,
    ageHours: 30,
    relevance,
    ranked: true,
    freshness: 0.5,
    position: n,
    engines: ['google'],
  };
}

export const CANNED_EVENTS = [
  CANNED_INTENT,
  { type: 'lane', source: 'google', engine: 'google', items: [row(1, 0.9), row(2, 0.8), row(3, 0.7)], stale: 0, searchMs: 800, scoreMs: 200 },
  { type: 'done', totalMs: 1234, tokens: 42 },
];

/**
 * Starts the fake on an ephemeral port. Behaviour keyed by the request text:
 *   contains "ratelimit" -> 429 with the upstream's error body
 *   otherwise            -> canned NDJSON stream
 * A request without a matching Origin header gets 403, like the real endpoint.
 */
export async function startFakeJev() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      requests.push({ url: req.url, method: req.method, headers: req.headers, body: body ? JSON.parse(body) : null });
      if (req.url !== '/api/ask' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      if (req.headers.origin !== origin) {
        res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'forbidden' }));
        return;
      }
      const q = requests.at(-1).body?.q ?? '';
      if (q.includes('ratelimit')) {
        res
          .writeHead(429, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: 'Too many searches from this address. Try again in a minute.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      const events = CANNED_EVENTS.map((e) => (e.type === 'intent' ? { ...e, request: q, query: q } : e));
      res.end(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
