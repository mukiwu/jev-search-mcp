#!/usr/bin/env node
// Entry point for `npx jev-search-mcp`: the MCP server by default, or a one-shot `search`.
import { parseArgs } from 'node:util';
import { SOURCES, WINDOWS } from './client.js';
import { InvalidArgumentsError, MAX_RESULTS_CAP, readConfig, runJevSearch, validateArgs } from './tool.js';
import { VERSION } from './version.js';

const USAGE = `jev-search-mcp ${VERSION}

Usage:
  jev-search-mcp [serve]                    run the MCP server over stdio (default)
  jev-search-mcp search "<request>" [opts]  run one search and print the ranked results
  jev-search-mcp --help | --version

Search options:
  --window <${WINDOWS.join('|')}>      force a time window instead of letting Jev infer it
  --sources <a,b,...>              force sources: ${SOURCES.join(', ')}
  --max <n>                        results to print, 1 to ${MAX_RESULTS_CAP}
  --json                           print the raw merged result as JSON

Environment:
  JEV_SEARCH_BASE_URL              Jev Search instance, default https://jev.s1.dev
  JEV_SEARCH_TIMEOUT_MS            per-search timeout, default 35000
  JEV_SEARCH_MAX_RESULTS           default for --max / max_results, default 10
`;

async function search(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        window: { type: 'string' },
        sources: { type: 'string' },
        max: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  const { values, positionals } = parsed;
  const query = positionals.join(' ').trim();
  if (!query) {
    process.stderr.write('search needs a request, for example:\n  jev-search-mcp search "rust async runtimes on Hacker News this month"\n');
    process.exit(2);
  }

  const raw = { query };
  if (values.window !== undefined) raw.window = values.window;
  if (values.sources !== undefined) raw.sources = values.sources.split(',').map((s) => s.trim()).filter(Boolean);
  if (values.max !== undefined) raw.max_results = Number(values.max);

  let args;
  try {
    args = validateArgs(raw);
  } catch (error) {
    if (!(error instanceof InvalidArgumentsError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }

  const config = readConfig(process.env);
  try {
    const { text, result } = await runJevSearch(args, config);
    process.stdout.write(values.json ? `${JSON.stringify(result, null, 2)}\n` : `${text}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`jev_search failed against ${config.baseUrl}: ${reason}\n`);
    process.exit(1);
  }
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case undefined:
  case 'serve':
    await import('./server.js');
    break;
  case 'search':
    await search(rest);
    break;
  case '--help':
  case '-h':
  case 'help':
    process.stdout.write(USAGE);
    break;
  case '--version':
  case '-v':
    process.stdout.write(`${VERSION}\n`);
    break;
  default:
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(2);
}
