import { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  PingRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { ILedgerStore } from './storage/interface.js';
import { ALL_TOOLS, executeTool } from './tools/index.js';

export const MCP_PROTOCOL_VERSION = '2025-11-25';

export const SERVER_INFO = {
  name: 'khata-voice',
  version: '1.0.0'
};

/**
 * Creates an official Model Context Protocol Server instance
 * with all 4 KhataVoice financial tools registered.
 */
export function createKhataMcpServer(store: ILedgerStore): Server {
  const server = new Server(
    SERVER_INFO,
    {
      capabilities: {
        tools: {
          listChanged: false
        }
      }
    }
  );

  // 1. tools/list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOLS
    };
  });

  // 2. tools/call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const toolResult = await executeTool(name, args, store);
      return toolResult;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Tool execution failed: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  });

  // 3. ping handler
  server.setRequestHandler(PingRequestSchema, async () => {
    return {};
  });

  return server;
}

/**
 * Handles incoming Streamable HTTP requests (POST /mcp, GET /mcp, DELETE /mcp)
 * using the official MCP TypeScript SDK StreamableHTTPServerTransport.
 *
 * Configured in STATELESS mode (sessionIdGenerator: undefined) for full
 * AWS Lambda and horizontal scalability compatibility.
 */
export async function handleStreamableHttpRequest(
  req: Request,
  res: Response,
  store: ILedgerStore,
  parsedBody?: unknown
): Promise<void> {
  // Normalize Accept header to ensure compatibility with MCP Streamable HTTP spec
  const accept = req.headers['accept'] || '';
  if (!accept.includes('text/event-stream') && !accept.includes('application/json')) {
    req.headers['accept'] = 'application/json, text/event-stream';
  } else if (!accept.includes('text/event-stream') && req.method === 'POST') {
    // If client specified application/json without text/event-stream, append it per SDK requirement
    req.headers['accept'] = `${accept}, text/event-stream`;
  }

  const server = createKhataMcpServer(store);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless Streamable HTTP
    enableJsonResponse: true       // Support direct JSON responses for HTTP POST
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody ?? req.body);
}

/**
 * LEGACY SSE COMPATIBILITY HELPER
 * Kept strictly for backward compatibility with older test harnesses.
 */
export class KhataVoiceMcpServer {
  private store: ILedgerStore;
  public readonly protocolVersion = MCP_PROTOCOL_VERSION;
  public readonly serverInfo = SERVER_INFO;

  constructor(store: ILedgerStore) {
    this.store = store;
  }

  public registerSseConnection(res: Response): string {
    const sessionId = `legacy_sess_${Date.now()}`;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: endpoint\ndata: /mcp/message?sessionId=${sessionId}\n\n`);
    return sessionId;
  }

  public async handleJsonRpc(request: any, _sessionId?: string): Promise<any> {
    const reqId = request.id !== undefined ? request.id : null;
    if (!request || request.jsonrpc !== '2.0' || !request.method) {
      return {
        jsonrpc: '2.0',
        id: reqId,
        error: { code: -32600, message: 'Invalid Request' }
      };
    }

    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: reqId,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: SERVER_INFO,
          capabilities: { tools: { listChanged: false } }
        }
      };
    }

    if (request.method === 'notifications/initialized') return null;
    if (request.method === 'ping') return { jsonrpc: '2.0', id: reqId, result: {} };
    if (request.method === 'tools/list') return { jsonrpc: '2.0', id: reqId, result: { tools: ALL_TOOLS } };
    if (request.method === 'tools/call') {
      try {
        const result = await executeTool(request.params?.name, request.params?.arguments, this.store);
        return { jsonrpc: '2.0', id: reqId, result };
      } catch (err: unknown) {
        return {
          jsonrpc: '2.0',
          id: reqId,
          result: { content: [{ type: 'text', text: String(err) }], isError: true }
        };
      }
    }

    return { jsonrpc: '2.0', id: reqId, error: { code: -32601, message: `Method not found: ${request.method}` } };
  }

  public getActiveSessionCount(): number {
    return 0;
  }
}
