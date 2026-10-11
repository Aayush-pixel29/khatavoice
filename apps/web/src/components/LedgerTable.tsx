import React from 'react';
import { Transaction } from '../types.js';

interface LedgerTableProps {
  transactions: Transaction[];
}

function formatCurrency(amount: number): string {
  return `₹${new Intl.NumberFormat('en-IN').format(amount)}`;
}

export const LedgerTable: React.FC<LedgerTableProps> = ({ transactions }) => {
  return (
    <div className="content-card">
      <div className="card-title-bar">
        <h3 className="card-title">
          <span>📜</span> Real-Time Ledger Feed
        </h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          Showing latest {transactions.length} entries
        </span>
      </div>

      <div className="table-wrapper">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Customer</th>
              <th>Type</th>
              <th>Description / Memo</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  No transactions recorded yet. Speak a command to add one!
                </td>
              </tr>
            ) : (
              transactions.map((tx) => (
                <tr key={tx.id}>
                  <td style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                    {new Date(tx.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </td>
                  <td style={{ fontWeight: 600 }}>{tx.customerName}</td>
                  <td>
                    <span className={`type-badge ${tx.type}`}>
                      {tx.type === 'credit' ? '🟢 Jama' : '🔴 Udhaar'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {tx.description || 'Voice ledger entry'}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontFamily: 'var(--font-heading)',
                      fontWeight: 700,
                      color:
                        tx.type === 'credit' ? 'var(--credit-green)' : 'var(--debit-rose)'
                    }}
                  >
                    {tx.type === 'credit' ? '+' : '-'}
                    {formatCurrency(tx.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
