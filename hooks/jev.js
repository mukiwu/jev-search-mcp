// Claude Code function hooks: answer the built-in WebSearch with Jev Search, and
// fall back to the built-in tool whenever Jev cannot answer.
//
// Runs in the plugin environment (no Node, no DOM): everything outside comes
// through `$`. Reads the request body as one string via $.http.fetch.
import { foldEvents, httpError, parseNdjsonText, requestFor } from '../src/client.js';
import { describeWebSearch, planWebSearch, toWebSearchResult } from '../src/websearch-bridge.js';

export const DEFAULT_BASE_URL = 'https://jev.s1.dev';

/** The block appended to the conversation's first message, so no CLAUDE.md is needed. */
export const CONTEXT_BLOCK_NAME = 'jevSearch';
export const CONTEXT_GUIDANCE = [
  'The jev-search plugin is active in this session.',
  'WebSearch is answered by Jev Search: Jev reads the request, picks the sources (the open web, plus Hacker News, Reddit, GitHub, X, arXiv, YouTube, Wikipedia, IMDb or WeChat when the request calls for them) and a time window, and ranks every result by relevance. It falls back to the built-in search only when Jev cannot answer.',
  'For questions that need the web, such as news, docs, releases, opinions, or what people are saying on Hacker News, Reddit or X, call WebSearch first, with the request as one plain-language sentence that names the site and the time span in words (for example "what Hacker News says about Bun this month"). It answers in a few seconds and covers several sites in one call.',
  'When the question is really about a site\'s data (exact counts, points, ids, strict date ranges, full comment threads) and the site has a proper API, querying that API directly is the better tool: WebSearch ranks by relevance, not by engagement.',
  'Use the jev_search MCP tool only when you must force sources or window.',
].join('\n');

function flag(value, fallback) {
  if (value === undefined) return fallback;
  return value === true || value === 'true';
}

/**
 * Normalise the plugin's userConfig values, tolerating strings from older settings.
 * @param {import('claude-code').PluginOptions} [options]
 */
export function readOptions(options = {}) {
  const baseUrl = typeof options.baseUrl === 'string' && options.baseUrl.trim() ? options.baseUrl.trim() : DEFAULT_BASE_URL;
  const intercept = flag(options.intercept, true);
  const n = Number(options.maxResults);
  const maxResults = Number.isInteger(n) && n >= 1 && n <= 40 ? n : 10;
  return { baseUrl, intercept, maxResults };
}

/**
 * Answer one WebSearch call through Jev. Resolves to `{ result }` for the engine,
 * or `null` when the built-in tool should run instead (no hits after filtering).
 * Throws on transport or upstream failure; the caller decides to fall back.
 *
 * @param {import('claude-code').EngineInterface} $
 * @param {{ tool_use_id: string, query: string, allowed_domains?: string[], blocked_domains?: string[] }} e
 * @param {ReturnType<typeof readOptions>} settings
 */
export async function answerWithJev($, e, settings) {
  const started = Date.now();
  const plan = planWebSearch(e);
  const { url, init } = requestFor({ baseUrl: settings.baseUrl, query: plan.request, sources: plan.sources });
  const response = await $.http.fetch(url, init);
  if (!response.ok) throw httpError(response.status, response.text);
  const folded = foldEvents(parseNdjsonText(response.text));
  const { result, hits } = toWebSearchResult(folded, {
    toolUseId: e.tool_use_id,
    query: e.query,
    allowed: plan.allowed,
    blocked: plan.blocked,
    maxResults: settings.maxResults,
    durationSeconds: Math.round((Date.now() - started) / 100) / 10,
  });
  return hits > 0 ? { result, folded, hits } : null;
}

/**
 * The hooks module's entry: Claude Code calls it once per activation with the plugin's options.
 * @param {import('claude-code').On} on
 * @param {import('claude-code').PluginOptions} options
 */
export function register(on, options) {
  const settings = readOptions(options);

  // Guidance travels with the plugin: appended to the first message's context blocks,
  // beside CLAUDE.md, so every install gets it without the user writing anything.
  on('prompt.context', ($, e, next) => {
    if (!settings.intercept) return next(e);
    const blocks = e.blocks.filter((b) => b.name !== CONTEXT_BLOCK_NAME);
    return next({ ...e, blocks: [...blocks, { name: CONTEXT_BLOCK_NAME, text: CONTEXT_GUIDANCE }] });
  });

  on('tool.describe', { tool: 'WebSearch' }, ($, e, next) =>
    settings.intercept ? { ...e, description: describeWebSearch(e.description) } : next(e)
  );

  on('tool.call', { tool: 'WebSearch' }, async ($, e, next) => {
    if (!settings.intercept) return next(e);
    $.ui.status('Jev Search…');
    try {
      const answer = await answerWithJev($, e, settings);
      if (!answer) {
        $.ui.log(`Jev Search found nothing for "${e.query}"; using the built-in WebSearch`, { to: 'debug' });
        return next(e);
      }
      const { intent, totalMs } = answer.folded;
      const summary = `${answer.hits} result${answer.hits === 1 ? '' : 's'} via ${intent.sources.join(', ')} in ${((totalMs ?? 0) / 1000).toFixed(1)}s`;
      $.ui.toast(`Jev Search: ${summary}`);
      $.ui.log(`Jev Search answered WebSearch: ${summary}`, { to: 'debug' });
      return { result: answer.result };
    } catch (error) {
      if (next.signal.aborted) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      $.ui.log(`Jev Search unavailable (${reason}); using the built-in WebSearch`);
      return next(e);
    } finally {
      $.ui.status(undefined);
    }
  });
}
