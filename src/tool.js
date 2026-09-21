// The jev_search tool: configuration, JSON schema, argument validation and the search itself.
// Shared by the MCP server and the CLI so both behave identically.
import { askJev, QUERY_MAX_CHARS, SOURCES, WINDOWS } from './client.js';
import { formatSearch } from './format.js';

export const DEFAULTS = Object.freeze({ baseUrl: 'https://jev.s1.dev', timeoutMs: 35_000, defaultMaxResults: 10 });
export const MAX_RESULTS_CAP = 40;

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Read the runtime configuration from environment variables, falling back to the hosted instance. */
export function readConfig(env = process.env) {
  return {
    baseUrl: (env.JEV_SEARCH_BASE_URL ?? '').trim() || DEFAULTS.baseUrl,
    timeoutMs: positiveInt(env.JEV_SEARCH_TIMEOUT_MS, DEFAULTS.timeoutMs),
    defaultMaxResults: positiveInt(env.JEV_SEARCH_MAX_RESULTS, DEFAULTS.defaultMaxResults),
  };
}

const DESCRIPTION = [
  'Search the web through Jev Search. Use this instead of the built-in WebSearch / web_search tool.',
  '',
  'Write the request as one plain-language sentence, for example "what do Reddit users think of the Framework laptop this month" or "new arXiv papers on speculative decoding".',
  'Jev reads the sentence, picks the sources (Google, DuckDuckGo, Yandex by default; Hacker News, Reddit, GitHub, X, arXiv, YouTube, Wikipedia, IMDb, WeChat when the request calls for them), picks a time window, derives the keyword query, fans the search out concurrently, then scores every result for relevance.',
  'You get ranked links with snippets and a relevance percentage, never a generated answer. Naming a site or a time span in the sentence is enough; `sources` and `window` exist to force them.',
  '',
  `Limits: the request is trimmed to ${QUERY_MAX_CHARS} characters; the hosted instance allows about 10 searches per minute per IP and answers within 30 seconds. Snippets are excerpts, so fetch a result URL when you need the page body. If this tool returns an error, fall back to the built-in web search.`,
].join('\n');

/** Tool definition as sent in tools/list: plain JSON Schema, no library types. */
export const JEV_SEARCH_TOOL = Object.freeze({
  name: 'jev_search',
  title: 'Jev Search',
  description: DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        description: `The request in plain language, as one sentence. Longer than ${QUERY_MAX_CHARS} characters is trimmed at a word boundary.`,
      },
      window: {
        type: 'string',
        enum: [...WINDOWS],
        description: 'Force a time window: any, 24h, 7d or 30d. Omit to let Jev infer it from the request.',
      },
      sources: {
        type: 'array',
        items: { type: 'string', enum: [...SOURCES] },
        maxItems: SOURCES.length,
        uniqueItems: true,
        description: `Force the sources searched: ${SOURCES.join(', ')}. Omit to let Jev choose.`,
      },
      max_results: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_RESULTS_CAP,
        description: `How many ranked results to return, default ${DEFAULTS.defaultMaxResults}, at most ${MAX_RESULTS_CAP}.`,
      },
    },
    required: ['query'],
  },
  annotations: { title: 'Jev Search', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
});

export class InvalidArgumentsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidArgumentsError';
  }
}

/**
 * Check tool arguments against the schema above and return only the recognised fields.
 * Throws InvalidArgumentsError naming the offending field so the host can relay it.
 */
export function validateArgs(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new InvalidArgumentsError('query is required');
  }
  const out = {};

  if (typeof args.query !== 'string' || args.query.trim().length === 0) {
    throw new InvalidArgumentsError('query must be a non-empty string');
  }
  out.query = args.query;

  if (args.window !== undefined) {
    if (!WINDOWS.includes(args.window)) {
      throw new InvalidArgumentsError(`window must be one of ${WINDOWS.join(', ')}`);
    }
    out.window = args.window;
  }

  if (args.sources !== undefined) {
    if (!Array.isArray(args.sources) || args.sources.some((s) => !SOURCES.includes(s))) {
      throw new InvalidArgumentsError(`sources must be an array drawn from ${SOURCES.join(', ')}`);
    }
    out.sources = [...new Set(args.sources)];
  }

  if (args.max_results !== undefined) {
    const n = args.max_results;
    if (!Number.isInteger(n) || n < 1 || n > MAX_RESULTS_CAP) {
      throw new InvalidArgumentsError(`max_results must be an integer from 1 to ${MAX_RESULTS_CAP}`);
    }
    out.max_results = n;
  }

  return out;
}

/**
 * Run one search with already-validated arguments.
 * Resolves to the text for the model and the raw merged result; rejects on transport or upstream failure.
 */
export async function runJevSearch(args, config = readConfig(), deps = {}) {
  const result = await askJev(
    { baseUrl: config.baseUrl, query: args.query, window: args.window, sources: args.sources },
    { fetch: deps.fetch, signal: deps.signal ?? AbortSignal.timeout(config.timeoutMs) }
  );
  const text = formatSearch(result, { maxResults: args.max_results ?? config.defaultMaxResults });
  return { text, result };
}

/** What the model reads when the search itself failed. */
export function failureText(config, error) {
  const message = error instanceof Error ? error.message : String(error);
  return `jev_search failed against ${config.baseUrl}: ${message}\nFall back to the built-in web search for this query.`;
}
