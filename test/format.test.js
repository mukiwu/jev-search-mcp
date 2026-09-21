import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSearch } from '../src/format.js';

function baseResult(overrides = {}) {
  return {
    intent: {
      request: 'framework laptop reddit',
      query: 'framework laptop',
      window: '30d',
      sources: ['reddit', 'google'],
      judge: 'vercel',
      intentMs: 500,
    },
    items: [],
    lanes: [],
    errors: [],
    totalMs: 4321,
    truncatedQuery: false,
    ...overrides,
  };
}

function item(n, overrides = {}) {
  return {
    id: `google:google:${n}`,
    source: 'google',
    title: `Result ${n}`,
    url: `https://example.com/${n}`,
    snippet: `Snippet ${n}`,
    ageHours: null,
    relevance: 0.9 - n * 0.1,
    ranked: true,
    freshness: 0.5,
    position: n,
    engines: ['google'],
    ...overrides,
  };
}

test('formatSearch leads with what Jev understood and the timing', () => {
  const text = formatSearch(baseResult({ items: [item(1)] }), { maxResults: 10 });
  const head = text.split('\n')[0];
  assert.match(head, /framework laptop/);
  assert.match(head, /reddit, google/);
  assert.match(head, /30d/);
  assert.match(head, /4\.3s/);
});

test('formatSearch numbers results with relevance, url, snippet and engines', () => {
  const text = formatSearch(
    baseResult({ items: [item(1, { relevance: 0.87, engines: ['google', 'duckduckgo'], ageHours: 50 })] }),
    { maxResults: 10 }
  );
  assert.match(text, /1\. \[87%\] Result 1/);
  assert.match(text, /https:\/\/example\.com\/1/);
  assert.match(text, /Snippet 1/);
  assert.match(text, /google, duckduckgo/);
  assert.match(text, /2 days ago/);
});

test('formatSearch caps to maxResults and says how many were held back', () => {
  const items = Array.from({ length: 12 }, (_, i) => item(i + 1, { relevance: 0.5 }));
  const text = formatSearch(baseResult({ items }), { maxResults: 5 });
  assert.match(text, /5\. \[50%\]/);
  assert.doesNotMatch(text, /6\. \[/);
  assert.match(text, /7 more/);
});

test('formatSearch marks unscored rows instead of showing 0%', () => {
  const text = formatSearch(baseResult({ items: [item(1, { ranked: false, relevance: 0 })] }), { maxResults: 10 });
  assert.match(text, /1\. \[unscored\] Result 1/);
});

test('formatSearch truncates long snippets', () => {
  const text = formatSearch(baseResult({ items: [item(1, { snippet: 'x'.repeat(1000) })] }), { maxResults: 10, snippetChars: 200 });
  const snippetLine = text.split('\n').find((l) => l.trim().startsWith('xxxx'));
  assert.ok(snippetLine.trim().length <= 201, `snippet line is ${snippetLine.trim().length} chars`);
});

test('formatSearch lists lane errors and a truncated-query notice', () => {
  const text = formatSearch(
    baseResult({
      items: [item(1)],
      errors: [{ source: 'hackernews', engine: 'hackernews', message: 'HTTP 504' }],
      truncatedQuery: true,
    }),
    { maxResults: 10 }
  );
  assert.match(text, /hackernews\/hackernews: HTTP 504/);
  assert.match(text, /300/);
});

test('formatSearch says so when nothing came back', () => {
  const text = formatSearch(baseResult(), { maxResults: 10 });
  assert.match(text, /No results/i);
});
