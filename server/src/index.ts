import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getLedgerStore } from './storage/index.js';
import {
  handleStreamableHttpRequest,
  KhataVoiceMcpServer,
  MCP_PROTOCOL_VERSION
} from './server.js';
import { VoiceParser } from './ai/parser.js';
import { CollectionsCopilot } from './ai/collectionsCopilot.js';
import { executeTool } from './tools/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// Allowed Origins for CORS (Simulator + Localhost + Env overrides)
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [])
];

// Allowed Hosts for DNS rebinding protection
const ALLOWED_HOSTS = [
  'localhost',
  'localhost:3001',
  '127.0.0.1',
  '127.0.0.1:3001',
  ...(process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(',') : [])
];

// 1. Host Header Validation Middleware
app.use((req, res, next) => {
  const host = req.headers.host;
  if (!host) {
    return next();
  }

  const isAllowed = ALLOWED_HOSTS.some(
    allowed => host === allowed || host.startsWith(allowed + ':')
  );

  if (!isAllowed && process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Forbidden: Invalid Host header' });
    return;
  }
  next();
});

// 2. Strict CORS Configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser agents (Alexa+, curl, server-to-server) where origin is undefined
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Mcp-Session-Id', 'Authorization'],
    credentials: true
  })
);

app.use(express.json());

// Initialize store, MCP server, voice parser, and Collections Copilot
const store = getLedgerStore();
const legacyMcpServer = new KhataVoiceMcpServer(store);
const voiceParser = new VoiceParser();
const collectionsCopilot = new CollectionsCopilot();

// 3. Health check & Server Info
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'KhataVoice MCP Server',
    protocolVersion: MCP_PROTOCOL_VERSION,
    transport: 'Streamable HTTP (MCP 2025-11-25)',
    canonicalEndpoint: '/mcp',
    storageDriver: process.env.STORAGE_DRIVER || 'memory',
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// CANONICAL MCP ENDPOINT: Streamable HTTP (MCP 2025-11-25)
// ============================================================================

/**
 * Validates Authorization header when MCP_API_KEY is configured or in production.
 * In local/dev mode without MCP_API_KEY, authentication is optional for zero-friction evaluation.
 * Never logs the API key or raw tokens.
 */
export function mcpAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const mcpApiKey = process.env.MCP_API_KEY;
  const isDevOrLocal = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'local' || !process.env.NODE_ENV;

  // In local/dev mode without configured key, bypass auth
  if (isDevOrLocal && !mcpApiKey) {
    return next();
  }

  // Pre-flight OPTIONS bypass
  if (req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    res.status(401).json({
      jsonrpc: '2.0',
      id: req.body?.id ?? null,
      error: { code: -32000, message: 'Unauthorized: Missing Authorization header' }
    });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({
      jsonrpc: '2.0',
      id: req.body?.id ?? null,
      error: { code: -32000, message: 'Unauthorized: Invalid Authorization header format. Expected Bearer token' }
    });
    return;
  }

  const token = parts[1];
  if (!mcpApiKey || token !== mcpApiKey) {
    res.status(401).json({
      jsonrpc: '2.0',
      id: req.body?.id ?? null,
      error: { code: -32000, message: 'Unauthorized: Invalid API key' }
    });
    return;
  }

  next();
}

app.all('/mcp', mcpAuthMiddleware, async (req, res) => {
  try {
    await handleStreamableHttpRequest(req, res, store, req.body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MCP Streamable HTTP] Uncaught handler error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id ?? null,
        error: { code: -32603, message: `Internal error: ${msg}` }
      });
    }
  }
});

// ============================================================================
// LEGACY SSE COMPATIBILITY (Deprecated - Kept strictly for backward compatibility)
// ============================================================================
app.get('/mcp/sse', (_req, res) => {
  legacyMcpServer.registerSseConnection(res);
});

app.post('/mcp/message', async (req, res) => {
  const sessionId = req.query.sessionId as string | undefined;
  try {
    const response = await legacyMcpServer.handleJsonRpc(req.body, sessionId);
    if (response) {
      res.status(200).json(response);
    } else {
      res.status(204).end();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: { code: -32603, message: `Internal error: ${msg}` }
    });
  }
});

// 4. Voice Processing Bridge (Speech Transcript -> Bedrock / NLP -> MCP Tool -> Audio Ready String)
// Trust boundary: Protected by mcpAuthMiddleware when MCP_API_KEY is configured or in production.
app.post('/api/voice/process', mcpAuthMiddleware, async (req, res) => {
  // execute=false: return the parsed intent only, so the client performs the single
  // tools/call itself over canonical POST /mcp (prevents double ledger mutation).
  const { text, merchant_id, execute } = req.body;
  const shouldExecute = execute !== false;

  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'Text prompt is required' });
    return;
  }

  try {
    const intent = await voiceParser.parseUtterance(text);

    // If intent is Collections Copilot, route to agent orchestrator
    if (intent.toolName === 'collections_copilot') {
      const plan = await collectionsCopilot.generatePlan({
        merchantId: merchant_id || 'default_merchant',
        query: text
      }, store);

      res.json({
        success: true,
        userUtterance: text,
        intent,
        toolResult: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(plan.copilotResult, null, 2)
            }
          ],
          isError: false
        },
        copilotResult: plan.copilotResult,
        voiceMessage: plan.voiceMessage,
        mcpToolCalls: plan.mcpToolCalls,
        diagnostics: plan.diagnostics
      });
      return;
    }

    if (!shouldExecute) {
      res.json({ success: true, userUtterance: text, intent, executed: false });
      return;
    }

    const toolArgs = {
      ...intent.arguments,
      merchant_id: merchant_id || intent.arguments.merchant_id || 'default_merchant'
    };

    const toolResult = await executeTool(intent.toolName, toolArgs, store);

    let voiceMessage = 'Transaction completed successfully.';
    if (toolResult.content && toolResult.content[0]?.text) {
      try {
        const parsedResult = JSON.parse(toolResult.content[0].text);
        if (parsedResult.voiceMessage) {
          voiceMessage = parsedResult.voiceMessage;
        }
      } catch {
        // fallback
      }
    }

    res.json({
      success: true,
      userUtterance: text,
      intent,
      toolResult,
      voiceMessage
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      error: errorMsg
    });
  }
});

// 4b. Dedicated Collections Copilot Endpoint (Agentic reasoning over real MCP tools)
// Trust boundary: Protected by mcpAuthMiddleware when MCP_API_KEY is configured or in production.
app.post('/api/copilot/collections', mcpAuthMiddleware, async (req, res) => {
  const { merchant_id, query } = req.body;
  try {
    const plan = await collectionsCopilot.generatePlan({
      merchantId: merchant_id || 'default_merchant',
      query: query || 'Who should I collect money from today?'
    }, store);
    res.json({
      success: true,
      ...plan
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

app.get('/api/copilot/collections', mcpAuthMiddleware, async (req, res) => {
  const merchantId = (req.query.merchant_id as string) || 'default_merchant';
  const query = (req.query.query as string) || 'Who should I collect money from today?';
  try {
    const plan = await collectionsCopilot.generatePlan({
      merchantId,
      query
    }, store);
    res.json({
      success: true,
      ...plan
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// 5. Dashboard Ledger Data Endpoint (for React UI live state)
// Trust boundary: Protected by mcpAuthMiddleware when MCP_API_KEY is configured or in production.
app.get('/api/ledger/dashboard', mcpAuthMiddleware, async (req, res) => {
  const merchantId = (req.query.merchant_id as string) || 'default_merchant';

  try {
    const [recentTransactions, customers, dues, dailySummary] = await Promise.all([
      store.getRecentTransactions(merchantId, 20),
      store.getAllCustomers(merchantId),
      store.getDues(merchantId, { limit: 10 }),
      store.getDailySummary(merchantId)
    ]);

    res.json({
      merchantId,
      recentTransactions,
      customers,
      dues,
      dailySummary
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: errorMsg });
  }
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  🎙️  KhataVoice MCP Server running on port ${PORT}`);
  console.log(`  ⚡  Canonical Endpoint: POST/GET/DELETE http://localhost:${PORT}/mcp`);
  console.log(`  📊  Health Endpoint:    GET http://localhost:${PORT}/health`);
  console.log(`  ⚙️   Transport Mode:     Stateless Streamable HTTP (MCP 2025-11-25)`);
  console.log(`  💾  Storage Driver:     ${process.env.STORAGE_DRIVER || 'memory'}`);
  console.log(`=======================================================`);
});
