import React from 'react';
import { DailySummary, DuesResult } from '../types.js';

interface SummaryCardsProps {
  dailySummary?: DailySummary;
  dues?: DuesResult;
}

function formatCurrency(amount: number): string {
  const isNegative = amount < 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0
  }).format(Math.abs(amount));
  return `${isNegative ? '-' : ''}₹${formatted}`;
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({ dailySummary, dues }) => {
  const totalCredit = dailySummary?.totalCreditReceived || 0;
  const totalDebit = dailySummary?.totalDebitGiven || 0;
  const netCash = dailySummary?.netCashFlow || 0;
  const totalDues = dues?.totalOutstandingDues || 0;

  return (
    <div className="summary-grid">
      <div className="stat-card credit">
        <div className="stat-header">
          <span className="stat-title">Today's Collections (Jama)</span>
          <span className="stat-icon">💵</span>
        </div>
        <span className="stat-value">{formatCurrency(totalCredit)}</span>
        <span className="stat-subtext">Cash & digital repayments received</span>
      </div>

      <div className="stat-card debit">
        <div className="stat-header">
          <span className="stat-title">Today's Credit Given (Udhaar)</span>
          <span className="stat-icon">📦</span>
        </div>
        <span className="stat-value">{formatCurrency(totalDebit)}</span>
        <span className="stat-subtext">Goods extended on ledger credit</span>
      </div>

      <div className="stat-card net">
        <div className="stat-header">
          <span className="stat-title">Net Daily Cash Flow</span>
          <span className="stat-icon">⚖️</span>
        </div>
        <span className="stat-value">{formatCurrency(netCash)}</span>
        <span className="stat-subtext">
          {dailySummary?.transactionCount || 0} transactions recorded today
        </span>
      </div>

      <div className="stat-card dues">
        <div className="stat-header">
          <span className="stat-title">Total Outstanding Dues</span>
          <span className="stat-icon">⏳</span>
        </div>
        <span className="stat-value">{formatCurrency(totalDues)}</span>
        <span className="stat-subtext">
          Pending collection across {dues?.debtorCount || 0} customers
        </span>
      </div>
    </div>
  );
};
