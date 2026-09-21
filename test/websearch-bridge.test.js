import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeWebSearch, filterByDomains, hostMatches, planWebSearch, toWebSearchResult } from '../src/websearch-bridge.js';

function item(url, relevance, extra = {}) {
  return {
    id: url,
    source: 'google',
    title: `Title ${url}`,
    url,
    snippet: 'snippet',
    ageHours: null,
    relevance,
    ranked: true,
    freshness: 0.5,
    position: 1,
    engines: ['google'],
    ...extra,
  };
}

const FOLDED = {
  intent: { query: 'bun', sources: ['google'], window: 'any', judge: 'vercel', intentMs: 100 },
  items: [item('https://bun.sh/blog', 0.9), item('https://www.reddit.com/r/bun/1', 0.8), item('https://news.ycombinator.com/item?id=1', 0.7)],
  lanes: [],
  errors: [],
  totalMs: 1500,
};

test('planWebSearch passes a bare query through and lets Jev choose sources', () => {
  assert.deepEqual(planWebSearch({ query: 'bun 1.3 release' }), { request: 'bun 1.3 release', sources: undefined, allowed: [], blocked: [] });
});

test('planWebSearch maps allowed domains onto Jev sources when every one is known', () => {
  const plan = planWebSearch({ query: 'bun', allowed_domains: ['reddit.com', 'www.news.ycombinator.com', 'old.reddit.com'] });
  assert.deepEqual(plan.sources, ['reddit', 'hackernews']);
  assert.equal(plan.request, 'bun');
  assert.deepEqual(plan.allowed, ['reddit.com', 'news.ycombinator.com', 'old.reddit.com']);
});

test('planWebSearch names unknown allowed domains in the sentence instead of restricting sources', () => {
  const plan = planWebSearch({ query: 'bun', allowed_domains: ['bun.sh', 'reddit.com'] });
  assert.equal(plan.sources, undefined);
  assert.equal(plan.request, 'bun from bun.sh or reddit.com');
});

test('hostMatches accepts the domain and its subdomains only', () => {
  assert.equal(hostMatches('https://www.reddit.com/r/x', 'reddit.com'), true);
  assert.equal(hostMatches('https://old.reddit.com/r/x', 'reddit.com'), true);
  assert.equal(hostMatches('https://notreddit.com/', 'reddit.com'), false);
  assert.equal(hostMatches('nonsense', 'reddit.com'), false);
});

test('filterByDomains enforces allowed and blocked lists', () => {
  const kept = filterByDomains(FOLDED.items, { allowed: ['reddit.com', 'bun.sh'], blocked: ['bun.sh'] });
  assert.deepEqual(kept.map((i) => i.url), ['https://www.reddit.com/r/bun/1']);
});

test('toWebSearchResult produces the WebSearch output record with links and ranked text', () => {
  const { result, hits } = toWebSearchResult(FOLDED, { toolUseId: 'toolu_1', query: 'bun', allowed: [], blocked: [], maxResults: 2, durationSeconds: 1.6 });
  assert.equal(hits, 2);
  assert.equal(result.query, 'bun');
  assert.equal(result.durationSeconds, 1.6);
  assert.equal(result.searchCount, 1);
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results[0], {
    tool_use_id: 'toolu_1',
    content: [
      { title: 'Title https://bun.sh/blog', url: 'https://bun.sh/blog' },
      { title: 'Title https://www.reddit.com/r/bun/1', url: 'https://www.reddit.com/r/bun/1' },
    ],
  });
  assert.match(result.results[1], /Answered by Jev Search/);
  assert.match(result.results[1], /1\. \[90%\]/);
  assert.match(result.results[1], /1 more result/);
});

test('toWebSearchResult reports zero hits when the domain filter removes everything', () => {
  const { hits } = toWebSearchResult(FOLDED, { toolUseId: 't', query: 'bun', allowed: ['example.org'], blocked: [], maxResults: 5 });
  assert.equal(hits, 0);
});

test('describeWebSearch appends the Jev guidance exactly once', () => {
  const once = describeWebSearch('Search the web.');
  assert.match(once, /^Search the web\.\n\n.*Jev Search/s);
  assert.match(once, /instead of scripting curl/, 'steers the model away from hand-rolled site API calls');
  assert.equal(describeWebSearch(once), once);
});
