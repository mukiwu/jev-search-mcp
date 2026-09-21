// Drives src/server.js over real stdio with the official SDK client, against a fake upstream.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFakeJev } from './helpers/fake-jev.js';

const serverPath = fileURLToPath(new URL('../src/server.js', import.meta.url));

let fake;
let client;

before(async () => {
  fake = await startFakeJev();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, JEV_SEARCH_BASE_URL: fake.baseUrl, JEV_SEARCH_MAX_RESULTS: '10' },
  });
  client = new Client({ name: 'jev-search-test', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await fake?.close();
});

test('initialize reports the server and a tools capability', () => {
  const info = client.getServerVersion();
  assert.equal(info.name, 'jev-search');
  assert.ok(client.getServerCapabilities().tools);
});

test('tools/list exposes jev_search with a JSON schema the host can validate against', async () => {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 1);
  const tool = tools[0];
  assert.equal(tool.name, 'jev_search');
  assert.match(tool.description, /WebSearch/);
  assert.equal(tool.inputSchema.type, 'object');
  assert.deepEqual(tool.inputSchema.required, ['query']);
  assert.deepEqual(tool.inputSchema.properties.window.enum, ['any', '24h', '7d', '30d']);
  assert.equal(tool.inputSchema.properties.sources.items.enum.length, 12);
  assert.equal(tool.annotations.readOnlyHint, true);
});

test('tools/call runs a search and hands back formatted text', async () => {
  const result = await client.callTool({ name: 'jev_search', arguments: { query: 'hello world', max_results: 2 } });
  assert.notEqual(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, /^Query: hello world/);
  assert.match(text, /1\. \[90%\] Fake result 1/);
  assert.match(text, /2\. \[80%\] Fake result 2/);
  assert.doesNotMatch(text, /3\. \[70%\]/);
  assert.match(text, /1 more result/);
  const sent = fake.requests.at(-1);
  assert.equal(sent.headers.origin, fake.baseUrl);
  assert.deepEqual(sent.body, { q: 'hello world' });
});

test('tools/call forwards window and sources', async () => {
  await client.callTool({ name: 'jev_search', arguments: { query: 'scoped', window: '7d', sources: ['hackernews', 'reddit'] } });
  assert.deepEqual(fake.requests.at(-1).body, { q: 'scoped', w: '7d', s: ['hackernews', 'reddit'] });
});

test('tools/call reports an upstream failure as a tool error, not a protocol error', async () => {
  const result = await client.callTool({ name: 'jev_search', arguments: { query: 'please ratelimit me' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /429/);
  assert.match(result.content[0].text, /Too many searches/);
  assert.match(result.content[0].text, /[Ff]all back/);
});

test('tools/call rejects invalid arguments with a JSON-RPC invalid params error', async () => {
  await assert.rejects(
    client.callTool({ name: 'jev_search', arguments: { query: 'x', window: 'yesterday' } }),
    (err) => /window/.test(err.message)
  );
  await assert.rejects(client.callTool({ name: 'jev_search', arguments: {} }), (err) => /query/.test(err.message));
});

test('tools/call for an unknown tool is a JSON-RPC error', async () => {
  await assert.rejects(client.callTool({ name: 'nope', arguments: {} }), (err) => /nope/.test(err.message));
});

test('ping is answered', async () => {
  await client.ping();
});
