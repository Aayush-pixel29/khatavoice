import React from 'react';

interface HeaderProps {
  ttsEnabled: boolean;
  onToggleTts: () => void;
  activeSessionId?: string;
  storageDriver: string;
}

export const Header: React.FC<HeaderProps> = ({
  ttsEnabled,
  onToggleTts,
  activeSessionId,
  storageDriver
}) => {
  return (
    <header className="header">
      <div className="brand-section">
        <div className="brand-icon">🎙️</div>
        <div className="brand-text">
          <h1>KhataVoice</h1>
          <p>Voice-First MCP Server & Digital Ledger (Spec 2025-11-25)</p>
        </div>
      </div>

      <div className="header-status">
        <div className="status-badge" title={`Active Storage Driver: ${storageDriver}`}>
          <span className="pulse-dot"></span>
          <span>MCP Online ({storageDriver.toUpperCase()})</span>
        </div>

        {activeSessionId && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
            {activeSessionId.substring(0, 16)}...
          </span>
        )}

        <button
          className={`tts-toggle ${ttsEnabled ? 'active' : ''}`}
          onClick={onToggleTts}
          title="Toggle Text-to-Speech audio readout for voice responses"
        >
          <span>{ttsEnabled ? '🔊 Audio Response: ON' : '🔇 Audio: OFF'}</span>
        </button>
      </div>
    </header>
  );
};
