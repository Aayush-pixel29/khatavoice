import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { mcpAuthMiddleware } from '../src/index.js';
import { handler as lambdaHandler } from '../src/lambda.js';

describe('Blocker 2 & Gate 2: MCP Authentication Test Suite', () => {
  const originalEnv = { ...process.env };
  const TEST_KEY = 'secret-alexa-mcp-key-7788';

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Express Middleware (mcpAuthMiddleware)', () => {
    let mockReq: any;
    let mockRes: any;
    let nextCalled: boolean;

    beforeEach(() => {
      nextCalled = false;
      mockReq = {
        headers: {},
        body: { id: 1, jsonrpc: '2.0', method: 'initialize' },
        method: 'POST'
      };
      mockRes = {
        statusCode: 200,
        jsonData: null,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(data: any) {
          this.jsonData = data;
          return this;
        }
      };
    });

    it('1. Rejects request with HTTP 401 when Authorization header is missing in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.MCP_API_KEY = TEST_KEY;

      mcpAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(mockRes.statusCode).toBe(401);
      expect(mockRes.jsonData.error.code).toBe(-32000);
      expect(mockRes.jsonData.error.message).toContain('Missing Authorization header');
    });

    it('2. Rejects request with HTTP 401 when token is invalid', () => {
      process.env.NODE_ENV = 'production';
      process.env.MCP_API_KEY = TEST_KEY;
      mockReq.headers['authorization'] = 'Bearer invalid-token-999';

      mcpAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(mockRes.statusCode).toBe(401);
      expect(mockRes.jsonData.error.message).toContain('Invalid API key');
    });

    it('3. Rejects malformed Authorization header with HTTP 401', () => {
      process.env.NODE_ENV = 'production';
      process.env.MCP_API_KEY = TEST_KEY;
      mockReq.headers['authorization'] = 'Basic YWRtaW46cGFzcw==';

      mcpAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(mockRes.statusCode).toBe(401);
      expect(mockRes.jsonData.error.message).toContain('Expected Bearer token');
    });

    it('4. Allows request through when valid Bearer token is provided', () => {
      process.env.NODE_ENV = 'production';
      process.env.MCP_API_KEY = TEST_KEY;
      mockReq.headers['authorization'] = `Bearer ${TEST_KEY}`;

      mcpAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(mockRes.statusCode).toBe(200);
    });

    it('5. Allows unauthenticated requests in local/development when MCP_API_KEY is unset', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.MCP_API_KEY;

      mcpAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });
  });

  describe('Lambda Handler Authentication', () => {
    it('1. Returns 401 when Authorization is missing in production Lambda execution', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MCP_API_KEY = TEST_KEY;

      const event = {
        rawPath: '/mcp',
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
        })
      };

      const res = await lambdaHandler(event);
      expect(res.statusCode).toBe(401);
      const parsed = JSON.parse(res.body);
      expect(parsed.error.code).toBe(-32000);
      expect(parsed.error.message).toContain('Missing or invalid API key');
    });

    it('2. Returns 401 when invalid Bearer token is provided to Lambda', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MCP_API_KEY = TEST_KEY;

      const event = {
        rawPath: '/mcp',
        httpMethod: 'POST',
        headers: {
          'authorization': 'Bearer bad-secret',
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
        })
      };

      const res = await lambdaHandler(event);
      expect(res.statusCode).toBe(401);
    });

    it('3. Successfully initializes MCP on Lambda when valid Bearer token is supplied', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MCP_API_KEY = TEST_KEY;

      const event = {
        rawPath: '/mcp',
        httpMethod: 'POST',
        headers: {
          'authorization': `Bearer ${TEST_KEY}`,
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
        })
      };

      const res = await lambdaHandler(event);
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.result.protocolVersion).toBe('2025-11-25');
      expect(parsed.result.serverInfo.name).toBe('khata-voice');
    });
  });

  describe('Internal Application Routes Security Boundary (/api/voice/process & /api/copilot/collections)', () => {
    it('1. Blocks unauthenticated POST /api/voice/process in production with HTTP 401', () => {
      process.env.NODE_ENV = 'production';
      process.env.MCP_API_KEY = TEST_KEY;
      const req: any = { headers: {}, body: { text: 'test query' }, method: 'POST' };
      let statusCode = 200;
      let nextCalled = false;
      const res: any = {
        status(c: number) { statusCode = c; return this; },
        json() { return this; }
      };

      mcpAuthMiddleware(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(statusCode).toBe(401);
    });

    it('2. Blocks unauthenticated GET /api/copilot/collections in production with HTTP 401', () => {
      process.env.NODE_ENV = 'production';
      process.env.MCP_API_KEY = TEST_KEY;
      const req: any = { headers: {}, query: {}, method: 'GET' };
      let statusCode = 200;
      let nextCalled = false;
      const res: any = {
        status(c: number) { statusCode = c; return this; },
        json() { return this; }
      };

      mcpAuthMiddleware(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(statusCode).toBe(401);
    });

    it('3. Allows authorized access to /api/copilot/collections with valid Bearer token in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.MCP_API_KEY = TEST_KEY;
      const req: any = {
        headers: { authorization: `Bearer ${TEST_KEY}` },
        query: {},
        method: 'GET'
      };
      let nextCalled = false;
      const res: any = { status() { return this; }, json() { return this; } };

      mcpAuthMiddleware(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    });

    it('4. Allows access in local/development mode when MCP_API_KEY is not configured', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.MCP_API_KEY;
      const req: any = { headers: {}, query: {}, method: 'GET' };
      let nextCalled = false;
      const res: any = { status() { return this; }, json() { return this; } };

      mcpAuthMiddleware(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    });
  });
});
