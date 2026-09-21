// Client for jev-search's POST /api/ask, which streams newline-delimited JSON:
// one `intent`, then `found` and `lane` events as engines answer, then `done`.
//
// The pure pieces (prepareQuery, requestFor, parseNdjsonText, foldEvents) are shared with
// the Claude Code function hook, which runs without Node and reads the body as one string.
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

/** Trim and bound the request; throws on an empty one. */
export function prepareQuery(query) {
  const requested = (query ?? '').trim();
  if (!requested) throw new Error('query must be a non-empty string');
  if (requested.length <= QUERY_MAX_CHARS) return { q: requested, truncatedQuery: false };
  return { q: trimToWord(requested, QUERY_MAX_CHARS), truncatedQuery: true };
}

/** The origin of a base URL, without relying on URL being present. */
export function originOf(baseUrl) {
  try {
    return new URL(baseUrl).origin;
  } catch {
    const origin = /^(https?:\/\/[^/?#]+)/i.exec(baseUrl.trim())?.[1];
    if (!origin) throw new Error(`Invalid Jev Search base URL: ${baseUrl}`);
    return origin;
  }
}

/**
 * Build the HTTP request for one search. The endpoint accepts only same-origin
 * callers, so a non-browser client states the origin itself.
 *
 * @param {{ baseUrl: string, query: string, window?: string, sources?: string[] }} input
 */
export function requestFor({ baseUrl, query, window, sources }) {
  const { q, truncatedQuery } = prepareQuery(query);
  const origin = originOf(baseUrl);
  /** @type {{ q: string, w?: string, s?: string[] }} */
  const body = { q };
  if (window) body.w = window;
  if (sources && sources.length > 0) body.s = sources;
  return {
    url: `${origin}/api/ask`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', Origin: origin },
      body: JSON.stringify(body),
    },
    q,
    truncatedQuery,
  };
}

/** Parse a whole NDJSON body. Blank lines are skipped; a broken line throws. */
export function parseNdjsonText(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Yield one parsed JSON value per line, tolerating chunk boundaries anywhere. */
export async function* readNdjson(stream) {
  const reader = stream.getReader();
  // Node's TextDecoder takes { stream: true }; the hook environment's declaration does not, and never runs this path.
  const decoder = /** @type {any} */ (new TextDecoder());
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
 * Fold the event sequence into one result: lanes merged by URL, lane errors
 * collected, timing from `done`. Throws when no `intent` ever arrived.
 */
export function foldEvents(events) {
  let intent = null;
  let items = [];
  const lanes = [];
  const errors = [];
  let totalMs = null;
  let tokens = null;
  let streamError = null;

  for (const event of events) {
    switch (event?.type) {
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
  return { intent, items, lanes, errors, totalMs, tokens, streamError };
}

/** Turn a non-2xx response into a readable error. */
export function httpError(status, bodyText) {
  let detail = '';
  try {
    detail = JSON.parse(bodyText).error ?? bodyText;
  } catch {
    detail = bodyText ?? '';
  }
  return new Error(`Jev Search HTTP ${status}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
}

/**
 * Run one search and collect the stream into a single result.
 *
 * @param {{ baseUrl: string, query: string, window?: string, sources?: string[] }} input
 * @param {{ fetch?: (url: string, init?: Record<string, unknown>) => Promise<any>, signal?: AbortSignal }} [deps]
 */
export async function askJev(input, { fetch = /** @type {any} */ (globalThis).fetch, signal } = {}) {
  const { url, init, q, truncatedQuery } = requestFor(input);
  const response = await fetch(url, { ...init, signal });

  if (!response.ok) {
    let text = '';
    try {
      text = await response.text();
    } catch {
      /* body unreadable */
    }
    throw httpError(response.status, text);
  }

  let events;
  if (response.body && typeof response.body.getReader === 'function') {
    events = [];
    for await (const event of readNdjson(response.body)) events.push(event);
  } else {
    events = parseNdjsonText(await response.text());
  }

  return { query: q, truncatedQuery, ...foldEvents(events) };
}
