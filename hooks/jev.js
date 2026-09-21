// Claude Code function hooks: answer the built-in WebSearch with Jev Search, and
// fall back to the built-in tool whenever Jev cannot answer.
//
// Runs in the plugin environment (no Node, no DOM): everything outside comes
// through `$`. Reads the request body as one string via $.http.fetch.
import { foldEvents, httpError, parseNdjsonText, requestFor } from '../src/client.js';
import { describeWebSearch, planWebSearch, toWebSearchResult } from '../src/websearch-bridge.js';

export const DEFAULT_BASE_URL = 'https://jev.s1.dev';

/**
 * Normalise the plugin's userConfig values, tolerating strings from older settings.
 * @param {import('claude-code').PluginOptions} [options]
 */
export function readOptions(options = {}) {
  const baseUrl = typeof options.baseUrl === 'string' && options.baseUrl.trim() ? options.baseUrl.trim() : DEFAULT_BASE_URL;
  const intercept = options.intercept === undefined ? true : options.intercept === true || options.intercept === 'true';
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
