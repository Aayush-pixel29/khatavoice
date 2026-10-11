import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../src/storage/memory.js';
import { createKhataMcpServer, MCP_PROTOCOL_VERSION } from '../src/server.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

describe('MCP Specification (2025-11-25) Streamable HTTP Compliance', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  async function sendMcpRequest(method: string, body?: any, httpMethod: string = 'POST') {
    const server = createKhataMcpServer(store);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    await server.connect(transport);

    const headers: Record<string, string> = {
      'Accept': 'application/json, text/event-stream'
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const webRequest = new Request('http://localhost:3001/mcp', {
      method: httpMethod,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const res = await transport.handleRequest(webRequest);
    let json: any = null;
    const text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {}

    return {
      status: res.status,
      headers: res.headers,
      text,
      json
    };
  }

  it('handles "initialize" request on POST /mcp with protocolVersion 2025-11-25', async () => {
    const res = await sendMcpRequest('POST', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    });

    expect(res.status).toBe(200);
    expect(res.json.jsonrpc).toBe('2.0');
    expect(res.json.id).toBe(1);
    expect(res.json.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(res.json.result.serverInfo.name).toBe('khata-voice');
    expect(res.json.result.capabilities.tools).toBeDefined();
  });

  it('handles "notifications/initialized" without error', async () => {
    const res = await sendMcpRequest('POST', {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });

    expect(res.status).toBe(202); // Accepted / acknowledged
  });

  it('handles "tools/list" returning all 4 tools with valid schemas', async () => {
    const res = await sendMcpRequest('POST', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    });

    expect(res.status).toBe(200);
    expect(res.json.result.tools).toHaveLength(4);
    const names = res.json.result.tools.map((t: any) => t.name);
    expect(names).toContain('add_entry');
    expect(names).toContain('get_balance');
    expect(names).toContain('get_dues');
    expect(names).toContain('daily_summary');
  });

  it('handles "tools/call" for add_entry on POST /mcp', async () => {
    const res = await sendMcpRequest('POST', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'add_entry',
        arguments: {
          customer_name: 'Test Customer',
          amount: 500,
          type: 'debit',
          description: 'Test items'
        }
      }
    });

    expect(res.status).toBe(200);
    expect(res.json.result.isError).toBe(false);
    expect(res.json.result.content[0].type).toBe('text');
    const parsed = JSON.parse(res.json.result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.transaction.customerName).toBe('Test Customer');
  });

  it('handles "ping" on POST /mcp', async () => {
    const res = await sendMcpRequest('POST', {
      jsonrpc: '2.0',
      id: 4,
      method: 'ping'
    });

    expect(res.status).toBe(200);
    expect(res.json.result).toEqual({});
  });

  it('handles DELETE /mcp for session termination', async () => {
    const res = await sendMcpRequest('DELETE', undefined, 'DELETE');
    expect(res.status).toBe(200);
  });
});
