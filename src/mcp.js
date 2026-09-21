// A minimal Model Context Protocol server over stdio: JSON-RPC 2.0, one message per line,
// tools only. Kept dependency-free so the package runs straight from a plugin checkout or npx.

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export const JSON_RPC = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
});

export class JsonRpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
    this.data = data;
  }
}

function errorResponse(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

/**
 * @param {{
 *   name: string,
 *   version: string,
 *   instructions?: string,
 *   tools: Array<{
 *     name: string, title?: string, description?: string, inputSchema: object, annotations?: object,
 *     validate?: (args: unknown) => unknown,
 *     handler: (args: any) => Promise<{ content: Array<{ type: string, text?: string }>, isError?: boolean }>
 *   }>
 * }} options
 */
export function createMcpServer({ name, version, instructions, tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const listed = tools.map(({ validate: _v, handler: _h, ...visible }) => visible);

  async function dispatch(method, params) {
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
        const result = {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
        };
        if (instructions) result.instructions = instructions;
        return result;
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: listed };
      case 'tools/call': {
        const tool = byName.get(params?.name);
        if (!tool) throw new JsonRpcError(JSON_RPC.INVALID_PARAMS, `Unknown tool: ${String(params?.name)}`);
        let args = params?.arguments ?? {};
        if (tool.validate) {
          try {
            args = tool.validate(args);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new JsonRpcError(JSON_RPC.INVALID_PARAMS, `Invalid arguments for ${tool.name}: ${reason}`);
          }
        }
        // Failures inside the tool are a tool result, not a protocol error, so the model can react.
        try {
          return await tool.handler(args);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return { isError: true, content: [{ type: 'text', text: `${tool.name} failed: ${reason}` }] };
        }
      }
      default:
        throw new JsonRpcError(JSON_RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  /** Handle one decoded message. Resolves to the response, or null for a notification. */
  async function handle(message) {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      return errorResponse(null, JSON_RPC.INVALID_REQUEST, 'Invalid request');
    }
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;
    if (typeof method !== 'string') {
      return isNotification ? null : errorResponse(id, JSON_RPC.INVALID_REQUEST, 'Invalid request: method missing');
    }
    if (isNotification) return null; // notifications/initialized, notifications/cancelled, ...
    try {
      const result = await dispatch(method, params);
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      if (error instanceof JsonRpcError) return errorResponse(id, error.code, error.message, error.data);
      const reason = error instanceof Error ? error.message : String(error);
      return errorResponse(id, JSON_RPC.INTERNAL_ERROR, reason);
    }
  }

  /** Read newline-delimited JSON from `input`, write responses to `output`, exit when input closes. */
  function serve({ input = process.stdin, output = process.stdout, onClose = () => process.exit(0) } = {}) {
    let buffer = '';
    const write = (msg) => output.write(`${JSON.stringify(msg)}\n`);
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          write(errorResponse(null, JSON_RPC.PARSE_ERROR, 'Parse error'));
          continue;
        }
        handle(message).then((response) => {
          if (response) write(response);
        });
      }
    });
    input.on('end', onClose);
    input.on('close', onClose);
  }

  return { handle, serve };
}
