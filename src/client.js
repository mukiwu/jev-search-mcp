// Client for jev-search's POST /api/ask, which streams newline-delimited JSON:
// one `intent`, then `found` and `lane` events as engines answer, then `done`.
import { mergeItems } from './rank.js';

export const QUERY_MAX_CHARS = 300;
export const WINDOWS = ['any', '24h', '7d', '30d'];
export const SOURCES = [
  'google',
  'duckduckgo',
  'yandex',
  'hackernews',
  'reddit',
  'github',
  'x',
  'arxiv',
  'youtube',
  'wikipedia',
  'imdb',
  'wechat',
];

/** Cut at the last word boundary that fits, so the engines still get whole words. */
function trimToWord(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max / 2 ? cut.slice(0, space) : cut).trim();
}

/** Yield one parsed JSON value per line, tolerating chunk boundaries anywhere. */
export async function* readNdjson(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (line) => (line.trim() ? JSON.parse(line) : undefined);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const event = parse(line);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    const last = parse(buffer);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Run one search and collect the stream into a single result.
 *
 * @param {{ baseUrl: string, query: string, window?: string, sources?: string[] }} input
 * @param {{ fetch?: typeof fetch, signal?: AbortSignal }} [deps]
 */
export async function askJev({ baseUrl, query, window, sources }, { fetch = globalThis.fetch, signal } = {}) {
  const requested = (query ?? '').trim();
  if (!requested) throw new Error('query must be a non-empty string');

  let q = requested;
  let truncatedQuery = false;
  if (q.length > QUERY_MAX_CHARS) {
    q = trimToWord(q, QUERY_MAX_CHARS);
    truncatedQuery = true;
  }

  // The endpoint accepts only same-origin callers; a non-browser client states the origin itself.
  const origin = new URL(baseUrl).origin;
  const body = { q };
  if (window) body.w = window;
  if (sources && sources.length > 0) body.s = sources;

  const response = await fetch(`${origin}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', Origin: origin },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let detail = '';
    try {
      const text = await response.text();
      try {
        detail = JSON.parse(text).error ?? text;
      } catch {
        detail = text;
      }
    } catch {
      /* body unreadable */
    }
    throw new Error(`Jev Search HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  if (!response.body) throw new Error('Jev Search returned an empty response');

  let intent = null;
  let items = [];
  const lanes = [];
  const errors = [];
  let totalMs = null;
  let tokens = null;
  let streamError = null;

  for await (const event of readNdjson(response.body)) {
    switch (event.type) {
      case 'intent':
        intent = event;
        break;
      case 'found':
        break; // progress only; the scored lane follows
      case 'lane':
        lanes.push(event);
        items = mergeItems(items, event.items ?? []);
        if (event.error) errors.push({ source: event.source, engine: event.engine, message: event.error });
        break;
      case 'done':
        totalMs = event.totalMs ?? null;
        tokens = event.tokens ?? null;
        break;
      case 'error':
        streamError = event.message ?? 'unknown stream error';
        break;
      default:
        break;
    }
  }

  if (!intent) throw new Error(streamError ?? 'Jev Search stream ended without an intent event');

  return { query: q, intent, items, lanes, errors, totalMs, tokens, streamError, truncatedQuery };
}
