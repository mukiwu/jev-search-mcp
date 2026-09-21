#!/usr/bin/env node
// MCP server (stdio) exposing Jev Search as one tool, `jev_search`. No runtime dependencies.
import { createMcpServer } from './mcp.js';
import { JEV_SEARCH_TOOL, failureText, readConfig, runJevSearch, validateArgs } from './tool.js';
import { VERSION } from './version.js';

const config = readConfig(process.env);

const server = createMcpServer({
  name: 'jev-search',
  version: VERSION,
  tools: [
    {
      ...JEV_SEARCH_TOOL,
      validate: validateArgs,
      handler: async (args) => {
        try {
          const { text } = await runJevSearch(args, config);
          return { content: [{ type: 'text', text }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: failureText(config, error) }] };
        }
      },
    },
  ],
});

server.serve();
