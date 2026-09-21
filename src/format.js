// Turn one search result into the text block the model reads.
import { rankItems } from './rank.js';

function age(item) {
  if (item.publishedDate) return item.publishedDate;
  const h = item.ageHours;
  if (h === null || h === undefined || !Number.isFinite(h)) return null;
  if (h < 1) return 'just now';
  if (h < 48) return `${Math.round(h)} hours ago`;
  const days = Math.round(h / 24);
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

function clip(text, max) {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function seconds(ms) {
  return ms === null || ms === undefined ? null : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * @param {import('./client.js').askJev extends (...a: any) => Promise<infer R> ? R : never} result
 * @param {{ maxResults?: number, snippetChars?: number }} [options]
 */
export function formatSearch(result, { maxResults = 10, snippetChars = 300 } = {}) {
  const { intent, errors = [], totalMs, truncatedQuery, streamError } = result;
  const ranked = rankItems(result.items ?? []);
  const shown = ranked.slice(0, Math.max(1, maxResults));
  const hidden = ranked.length - shown.length;

  const head = [
    `Query: ${intent.query}`,
    `sources: ${intent.sources.join(', ')}`,
    `window: ${intent.window}`,
    `judge: ${intent.judge}`,
  ];
  const took = seconds(totalMs);
  if (took) head.push(took);

  const lines = [head.join(' | ')];

  if (truncatedQuery) lines.push(`Note: the request was trimmed to ${300} characters, the Jev Search limit.`);
  if (streamError) lines.push(`Note: the stream ended early (${streamError}); results below may be partial.`);

  if (shown.length === 0) {
    lines.push('', 'No results.');
  } else {
    lines.push('');
    shown.forEach((item, i) => {
      const score = item.ranked ? `${Math.round(item.relevance * 100)}%` : 'unscored';
      lines.push(`${i + 1}. [${score}] ${clip(item.title, 200)}`);
      lines.push(`   ${item.url}`);
      const snippet = clip(item.snippet, snippetChars);
      if (snippet) lines.push(`   ${snippet}`);
      const meta = [`via ${item.engines.join(', ')}`];
      const when = age(item);
      if (when) meta.push(when);
      lines.push(`   ${meta.join(' · ')}`);
    });
    if (hidden > 0) lines.push('', `… ${hidden} more result${hidden === 1 ? '' : 's'} not shown; raise max_results to see them.`);
  }

  if (errors.length > 0) {
    lines.push('', `Lane errors: ${errors.map((e) => `${e.source}/${e.engine}: ${e.message}`).join('; ')}`);
  }

  lines.push('', 'Snippets are engine excerpts; fetch a URL when you need the page itself.');
  return lines.join('\n');
}
