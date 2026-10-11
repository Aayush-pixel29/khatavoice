import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header.js';
import { VoiceController } from './components/VoiceController.js';
import { CollectionsCopilot } from './components/CollectionsCopilot.js';
import { SummaryCards } from './components/SummaryCards.js';
import { DuesLeaderboard } from './components/DuesLeaderboard.js';
import { LedgerTable } from './components/LedgerTable.js';
import { CustomersList } from './components/CustomersList.js';
import { MCPInspector } from './components/MCPInspector.js';
import { DashboardData, McpLogEntry, CollectionsCopilotData } from './types.js';

export const App: React.FC = () => {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [copilotData, setCopilotData] = useState<CollectionsCopilotData | null>(null);
  const [copilotLoading, setCopilotLoading] = useState<boolean>(false);
  const [storageDriver, setStorageDriver] = useState<string>('memory');
  const [transportInfo, setTransportInfo] = useState<string>('Streamable HTTP (POST /mcp)');
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [lastVoiceResponse, setLastVoiceResponse] = useState<string | null>(null);
  const [mcpLogs, setMcpLogs] = useState<McpLogEntry[]>([]);
  const reqIdRef = useRef<number>(1);

  const addLog = useCallback(
    (
      direction: 'IN' | 'OUT',
      type: 'STREAMABLE_HTTP_REQ' | 'STREAMABLE_HTTP_RES',
      payload: any,
      method?: string
    ) => {
      setMcpLogs((prev) => [
        {
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          timestamp: new Date().toLocaleTimeString(),
          direction,
          type: type as any,
          method,
          payload
        },
        ...prev.slice(0, 49)
      ]);
    },
    []
  );

  // Helper to send canonical Streamable HTTP POST /mcp request
  const sendMcpPost = useCallback(
    async (payload: any, methodName?: string) => {
      addLog('OUT', 'STREAMABLE_HTTP_REQ', payload, methodName || payload.method);
      const res = await fetch('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify(payload)
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any;

      if (contentType.includes('text/event-stream')) {
        const text = await res.text();
        // Parse SSE data frame: "event: message\ndata: {...}"
        const match = text.match(/data:\s*(.+)/);
        if (match && match[1]) {
          try {
            data = JSON.parse(match[1]);
          } catch {
            data = text;
          }
        } else {
          data = text;
        }
      } else if (res.status === 202 || res.status === 204) {
        data = { status: res.status, acknowledged: true };
      } else {
        data = await res.json();
      }

      addLog('IN', 'STREAMABLE_HTTP_RES', data, methodName || payload.method);
      return { status: res.status, data };
    },
    [addLog]
  );

  // Fetch dashboard data
  const refreshDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/ledger/dashboard');
      if (res.ok) {
        const data = await res.json();
        setDashboard(data);
      }
    } catch (err) {
      console.warn('Failed to refresh ledger dashboard:', err);
    }
  }, []);

  // Fetch Collections Copilot priorities
  const refreshCopilot = useCallback(async () => {
    setCopilotLoading(true);
    try {
      const res = await fetch('/api/copilot/collections');
      if (res.ok) {
        const data = await res.json();
        if (data.copilotResult) {
          setCopilotData(data.copilotResult);
        }
        if (data.mcpToolCalls && Array.isArray(data.mcpToolCalls)) {
          // Log underlying real MCP tool executions for developer visibility
          for (const call of data.mcpToolCalls) {
            addLog('OUT', 'STREAMABLE_HTTP_REQ', { method: 'tools/call', params: { name: call.tool, arguments: call.args } }, `tools/call:${call.tool}`);
            addLog('IN', 'STREAMABLE_HTTP_RES', call.result, `tools/call:${call.tool}`);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to fetch Collections Copilot:', err);
    } finally {
      setCopilotLoading(false);
    }
  }, [addLog]);

  // Fetch health info, run MCP canonical handshake, and initialize data on mount
  useEffect(() => {
    fetch('/health')
      .then((res) => res.json())
      .then((info) => {
        if (info.storageDriver) setStorageDriver(info.storageDriver);
        if (info.transport) setTransportInfo(info.transport);
      })
      .catch(() => {});

    refreshDashboard();
    refreshCopilot();

    // Canonical MCP Handshake on startup: initialize -> initialized -> tools/list
    const runStartupHandshake = async () => {
      try {
        // 1. initialize
        await sendMcpPost(
          {
            jsonrpc: '2.0',
            id: reqIdRef.current++,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: {
                name: 'KhataVoice Simulator',
                version: '1.0.0'
              }
            }
          },
          'initialize'
        );

        // 2. notifications/initialized
        await sendMcpPost(
          {
            jsonrpc: '2.0',
            method: 'notifications/initialized'
          },
          'notifications/initialized'
        );

        // 3. tools/list
        await sendMcpPost(
          {
            jsonrpc: '2.0',
            id: reqIdRef.current++,
            method: 'tools/list',
            params: {}
          },
          'tools/list'
        );
      } catch (err) {
        console.warn('Startup MCP handshake failed:', err);
      }
    };

    runStartupHandshake();
  }, [sendMcpPost, refreshDashboard, refreshCopilot]);

  // Voice utterance processor
  const handleProcessUtterance = async (text: string) => {
    setIsProcessing(true);

    try {
      // 1. Extract intent & process via voice pipeline
      const voiceRes = await fetch('/api/voice/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const voiceData = await voiceRes.json();

      // If it routed to Collections Copilot
      if (voiceData.intent?.toolName === 'collections_copilot' && voiceData.copilotResult) {
        setCopilotData(voiceData.copilotResult);
        setLastVoiceResponse(voiceData.voiceMessage);

        if (voiceData.mcpToolCalls && Array.isArray(voiceData.mcpToolCalls)) {
          for (const call of voiceData.mcpToolCalls) {
            addLog('OUT', 'STREAMABLE_HTTP_REQ', { method: 'tools/call', params: { name: call.tool, arguments: call.args } }, `tools/call:${call.tool}`);
            addLog('IN', 'STREAMABLE_HTTP_RES', call.result, `tools/call:${call.tool}`);
          }
        }
      } else if (voiceData.intent?.toolName) {
        // Standard MCP tool call over canonical POST /mcp
        const mcpCallPayload = {
          jsonrpc: '2.0',
          id: reqIdRef.current++,
          method: 'tools/call',
          params: {
            name: voiceData.intent.toolName,
            arguments: voiceData.intent.arguments
          }
        };

        const { data } = await sendMcpPost(mcpCallPayload, `tools/call:${voiceData.intent.toolName}`);

        if (data?.result?.content?.[0]?.text) {
          try {
            const parsed = JSON.parse(data.result.content[0].text);
            if (parsed.voiceMessage) {
              setLastVoiceResponse(parsed.voiceMessage);
            }
          } catch {
            setLastVoiceResponse(voiceData.voiceMessage);
          }
        } else {
          setLastVoiceResponse(voiceData.voiceMessage);
        }

        // Refresh copilot when ledger mutations occur
        refreshCopilot();
      } else {
        setLastVoiceResponse(voiceData.voiceMessage);
      }

      await refreshDashboard();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastVoiceResponse(`Error processing command: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Test initialize handshake button
  const handleTestInitialize = async () => {
    await sendMcpPost(
      {
        jsonrpc: '2.0',
        id: reqIdRef.current++,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'KhataVoice Simulator', version: '1.0.0' }
        }
      },
      'initialize'
    );
  };

  // Test tools/list button
  const handleTestToolsList = async () => {
    await sendMcpPost(
      {
        jsonrpc: '2.0',
        id: reqIdRef.current++,
        method: 'tools/list',
        params: {}
      },
      'tools/list'
    );
  };

  // Test ping button
  const handleTestPing = async () => {
    await sendMcpPost(
      {
        jsonrpc: '2.0',
        id: reqIdRef.current++,
        method: 'ping'
      },
      'ping'
    );
  };

  return (
    <div className="app-container">
      <Header
        ttsEnabled={ttsEnabled}
        onToggleTts={() => setTtsEnabled(!ttsEnabled)}
        activeSessionId="POST /mcp (Stateless)"
        storageDriver={storageDriver}
      />

      <VoiceController
        onProcessUtterance={handleProcessUtterance}
        isProcessing={isProcessing}
        lastVoiceResponse={lastVoiceResponse}
        ttsEnabled={ttsEnabled}
      />

      <CollectionsCopilot
        data={copilotData}
        isLoading={copilotLoading}
        onRefresh={refreshCopilot}
        onAskPrompt={handleProcessUtterance}
        debtors={dashboard?.dues?.debtors || []}
        ttsEnabled={ttsEnabled}
      />

      <SummaryCards
        dailySummary={dashboard?.dailySummary}
        dues={dashboard?.dues}
      />

      <div className="dashboard-grid">
        <LedgerTable transactions={dashboard?.recentTransactions || []} />
        <DuesLeaderboard debtors={dashboard?.dues?.debtors || []} />
      </div>

      <CustomersList
        customers={dashboard?.customers || []}
        onSelectCustomer={(name) => handleProcessUtterance(`${name} ka balance batao`)}
      />

      <MCPInspector
        logs={mcpLogs}
        endpointUrl="POST /mcp"
        transportMode={transportInfo}
        onClearLogs={() => setMcpLogs([])}
        onTestInitialize={handleTestInitialize}
        onTestToolsList={handleTestToolsList}
        onTestPing={handleTestPing}
      />
    </div>
  );
};

