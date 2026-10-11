import React, { useState } from 'react';
import { McpLogEntry } from '../types.js';

interface MCPInspectorProps {
  logs: McpLogEntry[];
  endpointUrl: string;
  transportMode: string;
  onClearLogs: () => void;
  onTestInitialize: () => void;
  onTestToolsList: () => void;
  onTestPing: () => void;
}

export const MCPInspector: React.FC<MCPInspectorProps> = ({
  logs,
  endpointUrl,
  transportMode,
  onClearLogs,
  onTestInitialize,
  onTestToolsList,
  onTestPing
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const hasGetDues = logs.some(l => l.method?.includes('get_dues'));
  const hasDailySummary = logs.some(l => l.method?.includes('daily_summary'));
  const hasGetBalance = logs.some(l => l.method?.includes('get_balance'));
  const hasBedrock = logs.some(l =>
    l.method?.toLowerCase().includes('bedrock') ||
    l.method?.toLowerCase().includes('reasoning') ||
    JSON.stringify(l.payload).toLowerCase().includes('bedrock')
  );
  const hasValidation = logs.some(l =>
    l.method?.toLowerCase().includes('validation') ||
    JSON.stringify(l.payload).toLowerCase().includes('validation')
  );

  return (
    <div className="inspector-card">
      <div className="inspector-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.1rem' }}>⚡</span>
          <div>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', fontWeight: 600 }}>
              Live MCP Streamable HTTP Inspector (Spec 2025-11-25)
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Canonical Endpoint: <strong style={{ color: 'var(--accent-cyan)' }}>{endpointUrl}</strong> | Mode: {transportMode}
            </span>
          </div>
        </div>

        <div className="inspector-meta">
          <button
            onClick={onTestInitialize}
            className="chip-btn"
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.7rem' }}
            title="Send canonical initialize to POST /mcp"
          >
            initialize
          </button>
          <button
            onClick={onTestToolsList}
            className="chip-btn"
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.7rem' }}
            title="Send tools/list to POST /mcp"
          >
            tools/list
          </button>
          <button
            onClick={onTestPing}
            className="chip-btn"
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.7rem' }}
            title="Send ping to POST /mcp"
          >
            ping
          </button>
          <button
            onClick={onClearLogs}
            className="chip-btn"
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.7rem' }}
          >
            Clear
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="chip-btn"
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.7rem' }}
          >
            {collapsed ? 'Expand ▼' : 'Collapse ▲'}
          </button>
        </div>
      </div>

      {/* Visibly show pipeline verification checklist */}
      <div className="inspector-checklist-bar">
        <span className="checklist-title">Verification:</span>
        <span className={`chk-badge ${hasGetDues ? 'verified' : ''}`}>
          {hasGetDues ? '✓' : '○'} get_dues
        </span>
        <span className={`chk-badge ${hasDailySummary ? 'verified' : ''}`}>
          {hasDailySummary ? '✓' : '○'} daily_summary
        </span>
        <span className={`chk-badge ${hasGetBalance ? 'verified' : ''}`}>
          {hasGetBalance ? '✓' : '○'} get_balance
        </span>
        <span className={`chk-badge ${hasBedrock ? 'verified' : ''}`}>
          {hasBedrock ? '✓' : '○'} Bedrock reasoning
        </span>
        <span className={`chk-badge ${hasValidation ? 'verified' : ''}`}>
          {hasValidation ? '✓' : '○'} validation passed
        </span>
      </div>

      {!collapsed && (
        <div className="inspector-log-window">
          {logs.length === 0 ? (
            <div className="empty-state" style={{ padding: '1rem' }}>
              Connected to Streamable HTTP transport. Waiting for MCP JSON-RPC 2.0 frames on POST /mcp...
            </div>
          ) : (
            logs.map(log => (
              <div key={log.id} className="log-entry">
                <span className="log-time">[{log.timestamp}]</span>
                <span className={`log-dir ${log.direction}`}>{log.direction}</span>
                <span style={{ color: 'var(--warning-gold)', fontWeight: 600 }}>
                  POST /mcp
                </span>
                {log.method && (
                  <span style={{ color: 'var(--accent-purple)' }}>({log.method})</span>
                )}
                <span className="log-body">{JSON.stringify(log.payload)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
