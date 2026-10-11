import React from 'react';
import { DebtorItem } from '../types.js';

interface DuesLeaderboardProps {
  debtors: DebtorItem[];
}

function formatCurrency(amount: number): string {
  return `₹${new Intl.NumberFormat('en-IN').format(amount)}`;
}

export const DuesLeaderboard: React.FC<DuesLeaderboardProps> = ({ debtors }) => {
  const generateWhatsAppLink = (debtor: DebtorItem) => {
    const phone = debtor.phone?.replace(/[^0-9]/g, '') || '919876543210';
    const message = encodeURIComponent(
      `Namaste ${debtor.customerName} ji, aapke KhataVoice dukan ke ${formatCurrency(
        debtor.amountOwed
      )} rupaye baki hain. Kripya samay par UPI se bhej dijiye. Dhanyawad!`
    );
    return `https://wa.me/${phone}?text=${message}`;
  };

  return (
    <div className="content-card">
      <div className="card-title-bar">
        <h3 className="card-title">
          <span>⏳</span> Overdue Receivables Leaderboard
        </h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          Ranked by highest debt
        </span>
      </div>

      {debtors.length === 0 ? (
        <div className="empty-state">
          <p>🎉 All customer accounts are settled! No overdue debts.</p>
        </div>
      ) : (
        <div className="dues-list">
          {debtors.map((debtor, idx) => (
            <div key={`${debtor.customerName}-${idx}`} className="debtor-card">
              <div className="debtor-info">
                <h4>{debtor.customerName}</h4>
                <div className="debtor-meta">
                  <span>{debtor.phone || 'Phone not registered'}</span> •{' '}
                  <span style={{ color: debtor.daysPending > 7 ? 'var(--debit-rose)' : 'inherit' }}>
                    {debtor.daysPending === 0 ? 'Today' : `${debtor.daysPending} days pending`}
                  </span>
                </div>
              </div>

              <div className="debtor-action">
                <span className="debtor-amount">{formatCurrency(debtor.amountOwed)}</span>
                <a
                  href={generateWhatsAppLink(debtor)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wa-btn"
                  title="Send polite payment reminder on WhatsApp"
                >
                  <span>💬</span> Reminder
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
