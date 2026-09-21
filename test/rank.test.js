import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, mergeItems, rankItems } from '../src/rank.js';

function item(overrides) {
  return {
    id: 'google:google:1',
    source: 'google',
    title: 'T',
    url: 'https://example.com/a',
    snippet: 's',
    ageHours: null,
    relevance: 0.5,
    ranked: true,
    freshness: 0.5,
    position: 1,
    engines: ['google'],
    ...overrides,
  };
}

test('canonicalUrl folds www, trailing slash, tracking params and twitter host', () => {
  assert.equal(canonicalUrl('https://www.Example.com/Path/?utm_source=x&b=2&a=1'), 'example.com/path?a=1&b=2');
  assert.equal(canonicalUrl('https://twitter.com/foo/status/1'), 'x.com/foo/status/1');
  assert.equal(canonicalUrl('not a url'), 'not a url');
});

test('mergeItems unions engines, keeps the best relevance and rank, longest snippet', () => {
  const a = item({ url: 'https://example.com/a', relevance: 0.3, position: 3, snippet: 'short', engines: ['google'] });
  const b = item({ url: 'https://www.example.com/a/', relevance: 0.9, position: 1, snippet: 'a longer snippet', engines: ['duckduckgo'] });
  const out = mergeItems([a], [b]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].engines, ['google', 'duckduckgo']);
  assert.equal(out[0].relevance, 0.9);
  assert.equal(out[0].position, 1);
  assert.equal(out[0].snippet, 'a longer snippet');
});

test('mergeItems appends unseen urls in arrival order', () => {
  const out = mergeItems([item({ url: 'https://a.com' })], [item({ url: 'https://b.com' }), item({ url: 'https://c.com' })]);
  assert.deepEqual(out.map((i) => i.url), ['https://a.com', 'https://b.com', 'https://c.com']);
});

test('rankItems: unranked last, then relevance desc, then engine agreement, then position', () => {
  const unranked = item({ url: 'https://u.com', ranked: false, relevance: 0 });
  const low = item({ url: 'https://low.com', relevance: 0.4, position: 1 });
  const highOne = item({ url: 'https://h1.com', relevance: 0.9, engines: ['google'], position: 1 });
  const highTwo = item({ url: 'https://h2.com', relevance: 0.9, engines: ['google', 'yandex'], position: 5 });
  const highOneLater = item({ url: 'https://h3.com', relevance: 0.9, engines: ['google'], position: 2 });
  const out = rankItems([unranked, low, highOneLater, highOne, highTwo]);
  assert.deepEqual(
    out.map((i) => i.url),
    ['https://h2.com', 'https://h1.com', 'https://h3.com', 'https://low.com', 'https://u.com']
  );
});

test('rankItems does not mutate its input', () => {
  const input = [item({ url: 'https://b.com', relevance: 0.1 }), item({ url: 'https://a.com', relevance: 0.9 })];
  const copy = [...input];
  rankItems(input);
  assert.deepEqual(input, copy);
});
