import React, { useState } from 'react';
import { Customer } from '../types.js';

interface CustomersListProps {
  customers: Customer[];
  onSelectCustomer: (name: string) => void;
}

function formatCurrency(amount: number): string {
  return `₹${new Intl.NumberFormat('en-IN').format(Math.abs(amount))}`;
}

export const CustomersList: React.FC<CustomersListProps> = ({ customers, onSelectCustomer }) => {
  const [filter, setFilter] = useState('');

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="content-card">
      <div className="card-title-bar">
        <h3 className="card-title">
          <span>👥</span> Customer Ledger Directory
        </h3>
        <input
          type="text"
          placeholder="Search customer..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            background: 'var(--bg-glass)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-full)',
            padding: '0.3rem 0.85rem',
            color: '#fff',
            fontSize: '0.8rem',
            outline: 'none'
          }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
        {filtered.map(cust => {
          const isDebtor = cust.netBalance > 0;
          const isAdvance = cust.netBalance < 0;

          return (
            <div
              key={cust.id}
              onClick={() => onSelectCustomer(cust.name)}
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem 1rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem'
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-primary)';
                (e.currentTarget as HTMLElement).style.background = 'rgba(99, 102, 241, 0.06)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)';
                (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.02)';
              }}
              title="Click to query balance"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{cust.name}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>🔍</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-dim)' }}>
                  {isDebtor ? 'Udhaar' : isAdvance ? 'Advance' : 'Settled'}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: isDebtor
                      ? 'var(--debit-rose)'
                      : isAdvance
                      ? 'var(--credit-green)'
                      : 'var(--text-muted)'
                  }}
                >
                  {isDebtor ? '-' : isAdvance ? '+' : ''}
                  {formatCurrency(cust.netBalance)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
