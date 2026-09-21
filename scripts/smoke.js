#!/usr/bin/env node
// Spawns the server over stdio like a real MCP host would, lists its tools and runs one live search.
// Usage: node scripts/smoke.js ["your request"]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../src/server.js', import.meta.url));
const request = process.argv[2] ?? 'What do Hacker News readers think of Bun this month?';

const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env: process.env });
const client = new Client({ name: 'jev-search-smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

const t0 = performance.now();
const result = await client.callTool({ name: 'jev_search', arguments: { query: request, max_results: 5 } });
const ms = Math.round(performance.now() - t0);
console.log(`callTool: ${ms}ms, isError=${result.isError === true}`);
console.log('---');
console.log(result.content.map((c) => c.text ?? '').join('\n'));

await client.close();
process.exit(result.isError ? 1 : 0);
