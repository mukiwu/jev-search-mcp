// Translates between Claude Code's built-in WebSearch tool and Jev Search, in both
// directions: the WebSearch input becomes a Jev request, the Jev result becomes the
// record WebSearch's output schema expects. Pure functions, no I/O, so the function
// hook stays a thin wrapper and this file is tested with node:test.
import { formatSearch } from './format.js';
import { rankItems } from './rank.js';

/** Domains the model tends to pass as `allowed_domains` that map onto a Jev source. */
export const DOMAIN_SOURCES = Object.freeze({
  'reddit.com': 'reddit',
  'news.ycombinator.com': 'hackernews',
  'github.com': 'github',
  'arxiv.org': 'arxiv',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'wikipedia.org': 'wikipedia',
  'imdb.com': 'imdb',
  'x.com': 'x',
  'twitter.com': 'x',
  'mp.weixin.qq.com': 'wechat',
});

function normaliseDomain(domain) {
  return String(domain ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function sourceForDomain(domain) {
  const d = normaliseDomain(domain);
  if (DOMAIN_SOURCES[d]) return DOMAIN_SOURCES[d];
  for (const [known, source] of Object.entries(DOMAIN_SOURCES)) {
    if (d.endsWith(`.${known}`)) return source;
  }
  return undefined;
}

/** True when `url` is on `domain` or one of its subdomains. */
export function hostMatches(url, domain) {
  const d = normaliseDomain(domain);
  if (!d) return false;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^www\./, '');
  return host === d || host.endsWith(`.${d}`);
}

/**
 * Turn a WebSearch call into a Jev request. Allowed domains that all map onto Jev
 * sources become `sources`; otherwise they are named in the sentence and enforced
 * afterwards by filterByDomains. Blocked domains are only enforced afterwards.
 *
 * @param {{ query: string, allowed_domains?: string[], blocked_domains?: string[] }} call
 */
export function planWebSearch({ query, allowed_domains, blocked_domains }) {
  const allowed = (allowed_domains ?? []).map(normaliseDomain).filter(Boolean);
  const blocked = (blocked_domains ?? []).map(normaliseDomain).filter(Boolean);
  let request = String(query ?? '').trim();
  let sources;

  if (allowed.length > 0) {
    const mapped = allowed.map(sourceForDomain);
    if (mapped.every(Boolean)) {
      sources = [...new Set(mapped)];
    } else {
      request = `${request} from ${allowed.join(' or ')}`;
    }
  }

  return { request, sources, allowed, blocked };
}

/** Keep only rows inside the allowed domains and outside the blocked ones. */
export function filterByDomains(items, { allowed = [], blocked = [] } = {}) {
  return items.filter((item) => {
    if (blocked.some((d) => hostMatches(item.url, d))) return false;
    if (allowed.length > 0 && !allowed.some((d) => hostMatches(item.url, d))) return false;
    return true;
  });
}

/**
 * Build the record WebSearch's output schema describes from a folded Jev result.
 *
 * `results` carries one hit list (what the transcript renders as Links) and one text
 * block with Jev's ranking, so the model reads the same shape the built-in tool gives.
 */
export function toWebSearchResult(folded, { toolUseId, query, allowed, blocked, maxResults = 10, durationSeconds = 0 }) {
  const kept = filterByDomains(folded.items ?? [], { allowed, blocked });
  const ranked = rankItems(kept).slice(0, Math.max(1, maxResults));
  const text = formatSearch({ ...folded, items: kept }, { maxResults });
  const result = {
    query,
    results: [
      { tool_use_id: toolUseId, content: ranked.map((item) => ({ title: item.title, url: item.url })) },
      `Answered by Jev Search.\n${text}`,
    ],
    durationSeconds,
    searchCount: 1,
  };
  return { result, hits: ranked.length };
}

const DESCRIPTION_SUFFIX =
  'This tool is answered by Jev Search: phrase the query as one plain-language sentence and name a site or a time span in words when it matters (for example "what Hacker News says about Bun this month"). Results come back ranked with a relevance percentage and a snippet each. Reach for this first for any web lookup, including Hacker News, Reddit, GitHub, arXiv, YouTube, Wikipedia, IMDb and WeChat, instead of scripting curl against a site\'s search API; fall back to those APIs only when these results are not enough.';

/** Append the Jev guidance to WebSearch's own description, once. */
export function describeWebSearch(description) {
  const base = String(description ?? '').trimEnd();
  if (base.includes('Jev Search')) return base;
  return `${base}\n\n${DESCRIPTION_SUFFIX}`;
}
