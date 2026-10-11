import { getLedgerStore } from './storage/index.js';
import { createKhataMcpServer, MCP_PROTOCOL_VERSION } from './server.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { executeTool } from './tools/index.js';

const store = getLedgerStore();

/**
 * AWS Lambda handler for serverless Streamable HTTP MCP execution.
 * Handles API Gateway HTTP API and Lambda Function URL requests.
 */
export async function handler(event: any) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const rawPath = event.rawPath || event.path || '/';

  // 1. Health check
  if (rawPath === '/health' || rawPath === '/') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ok',
        service: 'KhataVoice MCP Server (AWS Lambda)',
        protocolVersion: MCP_PROTOCOL_VERSION,
        transport: 'Streamable HTTP (MCP 2025-11-25)',
        canonicalEndpoint: '/mcp',
        storageDriver: process.env.STORAGE_DRIVER || 'dynamodb'
      })
    };
  }

  // 2. Canonical Streamable HTTP endpoint: /mcp
  if (rawPath.endsWith('/mcp')) {
    const mcpApiKey = process.env.MCP_API_KEY;
    const isDevOrLocal = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'local';

    if (!isDevOrLocal || mcpApiKey) {
      if (method !== 'OPTIONS') {
        const authHeader = event.headers?.authorization || event.headers?.Authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7).trim() !== mcpApiKey) {
          return {
            statusCode: 401,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32000, message: 'Unauthorized: Missing or invalid API key' }
            })
          };
        }
      }
    }

    try {
      const headers = new Headers();
      if (event.headers) {
        for (const [k, v] of Object.entries(event.headers)) {
          if (v) headers.set(k, String(v));
        }
      }

      // Ensure Accept header is normalized
      const accept = headers.get('accept') || '';
      if (!accept.includes('text/event-stream') && !accept.includes('application/json')) {
        headers.set('accept', 'application/json, text/event-stream');
      } else if (!accept.includes('text/event-stream') && method === 'POST') {
        headers.set('accept', `${accept}, text/event-stream`);
      }

      const domain = event.requestContext?.domainName || 'localhost';
      const url = `https://${domain}${rawPath}`;
      const body = method === 'GET' || method === 'DELETE' ? undefined : event.body;

      const webRequest = new Request(url, {
        method,
        headers,
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
      });

      const server = createKhataMcpServer(store);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless Streamable HTTP
        enableJsonResponse: true
      });

      await server.connect(transport);
      const webResponse = await transport.handleRequest(webRequest);

      const responseHeaders: Record<string, string> = {
        'Access-Control-Allow-Origin': '*'
      };
      webResponse.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });

      const responseBody = await webResponse.text();

      return {
        statusCode: webResponse.status,
        headers: responseHeaders,
        body: responseBody
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: `Lambda MCP error: ${msg}` }
        })
      };
    }
  }

  // 3. Direct Tool execution convenience route
  if (rawPath.includes('/tools/call') && method === 'POST') {
    try {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      const result = await executeTool(body.name, body.arguments, store);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: msg })
      };
    }
  }

  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: `Not found: ${method} ${rawPath}` })
  };
}
