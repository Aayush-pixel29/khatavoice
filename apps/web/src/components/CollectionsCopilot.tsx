import React from 'react';
import { CollectionsCopilotData, PriorityItem, DebtorItem } from '../types.js';

interface CollectionsCopilotProps {
  data: CollectionsCopilotData | null;
  isLoading: boolean;
  onRefresh: () => void;
  onAskPrompt: (prompt: string) => void;
  debtors?: DebtorItem[];
  ttsEnabled?: boolean;
}

function formatCurrency(amount: number): string {
  return `₹${new Intl.NumberFormat('en-IN').format(amount)}`;
}

export const CollectionsCopilot: React.FC<CollectionsCopilotProps> = ({
  data,
  isLoading,
  onRefresh,
  onAskPrompt,
  debtors = [],
  ttsEnabled = true
}) => {
  const debtorMap = new Map<string, DebtorItem>();
  for (const d of debtors) {
    debtorMap.set(d.customerName.toLowerCase(), d);
  }

  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'hi-IN';
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  };

  const getPriorityBadgeClass = (priority: number) => {
    switch (priority) {
      case 1:
        return 'priority-badge p1';
      case 2:
        return 'priority-badge p2';
      case 3:
        return 'priority-badge p3';
      default:
        return 'priority-badge';
    }
  };

  const getPriorityLabel = (priority: number) => {
    switch (priority) {
      case 1:
        return 'P1 • High Urgency';
      case 2:
        return 'P2 • Medium Urgency';
      case 3:
        return 'P3 • Moderate';
      default:
        return `P${priority}`;
    }
  };

  return (
    <section className="collections-copilot-card">
      <div className="copilot-header">
        <div className="copilot-title-group">
          <div className="copilot-icon-badge">🎯</div>
          <div>
            <div className="copilot-tagline">
              <span className="copilot-badge">AGENTIC COPILOT</span>
              <span className="copilot-subbadge">Amazon Bedrock + Real MCP</span>
            </div>
            <h2 className="copilot-title">Collections Copilot</h2>
          </div>
        </div>

        <div className="copilot-actions">
          <button
            className="copilot-refresh-btn"
            onClick={onRefresh}
            disabled={isLoading}
            title="Re-run autonomous collections reasoning"
          >
            {isLoading ? '⏳ Reasoning...' : '🔄 Refresh Priorities'}
          </button>
        </div>
      </div>

      <div className="copilot-prompts-bar">
        <span className="copilot-prompts-label">Natural Voice Prompts:</span>
        <div className="copilot-prompt-chips">
          <button
            className="copilot-chip"
            onClick={() => onAskPrompt('Aaj kin logon se paise lene chahiye?')}
            disabled={isLoading}
          >
            "Aaj kin logon se paise lene chahiye?"
          </button>
          <button
            className="copilot-chip"
            onClick={() => onAskPrompt('Sabse pehle kis customer ko call karu?')}
            disabled={isLoading}
          >
            "Sabse pehle kis customer ko call karu?"
          </button>
          <button
            className="copilot-chip"
            onClick={() => onAskPrompt('Kaun sabse zyada overdue hai?')}
            disabled={isLoading}
          >
            "Kaun sabse zyada overdue hai?"
          </button>
          <button
            className="copilot-chip"
            onClick={() => onAskPrompt('Who should I collect money from today?')}
            disabled={isLoading}
          >
            "Who should I collect money from today?"
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="copilot-loading">
          <div className="copilot-spinner"></div>
          <p>Reasoning over real MCP tools (<code>get_dues</code>, <code>daily_summary</code>, <code>get_balance</code>)...</p>
        </div>
      ) : !data ? (
        <div className="copilot-empty">
          <p>No collections analysis generated yet. Click "Refresh Priorities" or speak a collections question.</p>
        </div>
      ) : (
        <div className="copilot-body">
          {/* Summary & Total Outstanding Ribbon */}
          <div className="copilot-summary-ribbon">
            <div className="copilot-outstanding-box">
              <span className="outstanding-label">Total Outstanding Dues</span>
              <span className="outstanding-amount">{formatCurrency(data.totalOutstanding)}</span>
              <span className="outstanding-note">Strictly verified against real ledger</span>
            </div>

            <div className="copilot-summary-text-box">
              <div className="summary-text-header">
                <span className="summary-title">💡 Collections Strategy</span>
                {ttsEnabled && (
                  <button
                    className="speak-btn"
                    onClick={() => handleSpeak(data.summary)}
                    title="Speak explanation aloud"
                  >
                    🔊 Listen
                  </button>
                )}
              </div>
              <p className="summary-description">{data.summary}</p>
            </div>
          </div>

          {/* Top 3 Prioritized Customers */}
          <div className="copilot-priorities-section">
            <div className="priorities-section-title">
              <h3>Top Customers to Collect from Today</h3>
              <span className="priorities-subtitle">Ranked by risk, aging, and recovery impact</span>
            </div>

            {data.priorities.length === 0 ? (
              <div className="copilot-no-dues">
                <span className="celebration-icon">🎉</span>
                <p>No customers have pending dues. All accounts are up-to-date!</p>
              </div>
            ) : (
              <div className="copilot-cards-grid">
                {data.priorities.slice(0, 3).map((item: PriorityItem) => {
                  const debtorMeta = debtorMap.get(item.customerName.toLowerCase());
                  return (
                    <div key={`${item.customerName}-${item.priority}`} className="priority-card">
                      <div className="priority-card-top">
                        <span className={getPriorityBadgeClass(item.priority)}>
                          {getPriorityLabel(item.priority)}
                        </span>
                        <span className="priority-amount">{formatCurrency(item.amount)}</span>
                      </div>

                      <div className="priority-customer-details">
                        <h4 className="priority-customer-name">{item.customerName}</h4>
                        <div className="priority-ledger-meta">
                          {debtorMeta?.phone && <span>📞 {debtorMeta.phone}</span>}
                          {debtorMeta && (
                            <span className="aging-badge">
                              ⏳ {debtorMeta.daysPending === 0 ? 'Due Today' : `${debtorMeta.daysPending} days pending`}
                            </span>
                          )}
                          {debtorMeta?.lastTransactionDate && (
                            <span className="date-badge">
                              🗓️ Last active: {debtorMeta.lastTransactionDate}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="priority-reason-box">
                        <span className="reason-label">Reasoning:</span>
                        <p className="priority-reason-text">{item.reason}</p>
                      </div>

                      <div className="priority-card-footer">
                        <button
                          className="copilot-action-btn"
                          onClick={() => onAskPrompt(`${item.customerName} ka balance batao`)}
                          title="Ask KhataVoice for balance details"
                        >
                          🔍 Check Details
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
