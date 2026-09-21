// Ordering and URL folding, ported from jev-search's src/lib/rank.ts and merge.ts so
// the MCP tool ranks the same way the web UI does.

const TRACKING_PARAM = /^(utm_|ref$|ref_|fbclid|gclid|igshid|share_id|rdt|si$|feature$|lang$|s$|t$)/i;

/** Host + path + the query params that identify content, minus tracking noise. */
export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    let host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'twitter.com') host = 'x.com';
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAM.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${host}${path}${params ? `?${params}` : ''}`;
  } catch {
    return url;
  }
}

/**
 * Fold a new lane into the rows already collected. The same URL from a second
 * engine is one row: engines are unioned, the higher relevance wins, the better
 * rank and the longer snippet are kept.
 */
export function mergeItems(existing, incoming) {
  const byUrl = new Map();
  const out = [];
  for (const item of existing) {
    byUrl.set(canonicalUrl(item.url), item);
    out.push(item);
  }
  for (const item of incoming) {
    const key = canonicalUrl(item.url);
    const found = byUrl.get(key);
    if (!found) {
      byUrl.set(key, item);
      out.push(item);
      continue;
    }
    const publication = (!found.publishedDate && item.publishedDate) || found.ageHours === null ? item : found;
    const merged = {
      ...found,
      engines: [...new Set([...found.engines, ...item.engines])],
      relevance: Math.max(found.relevance, item.relevance),
      ranked: found.ranked || item.ranked,
      position: Math.min(found.position, item.position),
      publishedDate: publication.publishedDate,
      ageHours: publication.ageHours,
      freshness: publication.freshness,
      snippet: found.snippet.length >= item.snippet.length ? found.snippet : item.snippet,
    };
    byUrl.set(key, merged);
    out[out.indexOf(found)] = merged;
  }
  return out;
}

/** Best match: judge percentage, ties by engine agreement, then engine rank. Unscored rows last. */
export function compareItems(a, b) {
  if (a.ranked !== b.ranked) return a.ranked ? -1 : 1;
  const ra = Math.round(a.relevance * 100);
  const rb = Math.round(b.relevance * 100);
  if (ra !== rb) return rb - ra;
  if (a.engines.length !== b.engines.length) return b.engines.length - a.engines.length;
  return a.position - b.position;
}

export function rankItems(items) {
  return [...items].sort(compareItems);
}
