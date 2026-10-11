import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../src/storage/memory.js';
import { handleAddEntry } from '../src/tools/addEntry.js';
import { handleGetBalance } from '../src/tools/getBalance.js';
import { handleGetDues } from '../src/tools/getDues.js';
import { handleDailySummary } from '../src/tools/dailySummary.js';

describe('KhataVoice Tools & Storage Logic', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
    store.reset(); // start with clean slate for tests
  });

  it('add_entry: should record a debit (udhaar) transaction correctly', async () => {
    const res = await handleAddEntry({
      customer_name: 'Rajesh Sharma',
      amount: 450,
      type: 'debit',
      description: 'Rice and sugar'
    }, store);

    expect(res.isError).toBe(false);
    const data = JSON.parse(res.content[0].text);
    expect(data.success).toBe(true);
    expect(data.customer.netBalance).toBe(450);
    expect(data.customer.totalDebit).toBe(450);
    expect(data.voiceMessage).toContain('Rajesh Sharma');
    expect(data.voiceMessage).toContain('udhaar');
  });

  it('add_entry: should record a credit (jama) transaction and deduct from dues', async () => {
    // 1. Give 500 udhaar
    await handleAddEntry({
      customer_name: 'Rajesh Sharma',
      amount: 500,
      type: 'debit'
    }, store);

    // 2. Customer pays back 300
    const payRes = await handleAddEntry({
      customer_name: 'Rajesh Sharma',
      amount: 300,
      type: 'credit',
      description: 'UPI payment'
    }, store);

    const data = JSON.parse(payRes.content[0].text);
    expect(data.customer.netBalance).toBe(200); // 500 - 300 = 200
    expect(data.customer.totalCredit).toBe(300);
    expect(data.voiceMessage).toContain('jama ho gaye hain');
  });

  it('get_balance: should return correct balance for customer', async () => {
    await handleAddEntry({
      customer_name: 'Kavita',
      amount: 1200,
      type: 'debit'
    }, store);

    const res = await handleGetBalance({ customer_name: 'Kavita' }, store);
    const data = JSON.parse(res.content[0].text);
    expect(data.netBalance).toBe(1200);
    expect(data.voiceMessage).toContain('1,200 rupaye');
  });

  it('get_balance: should report zero balance for unknown customer', async () => {
    const res = await handleGetBalance({ customer_name: 'Unknown Person' }, store);
    const data = JSON.parse(res.content[0].text);
    expect(data.netBalance).toBe(0);
    expect(data.voiceMessage).toContain('Khata shunya hai');
  });

  it('get_dues: should rank debtors in descending order of amount owed', async () => {
    await handleAddEntry({ customer_name: 'Small Debtor', amount: 100, type: 'debit' }, store);
    await handleAddEntry({ customer_name: 'Large Debtor', amount: 5000, type: 'debit' }, store);
    await handleAddEntry({ customer_name: 'Medium Debtor', amount: 1200, type: 'debit' }, store);

    const res = await handleGetDues({ limit: 5 }, store);
    const data = JSON.parse(res.content[0].text);

    expect(data.debtorCount).toBe(3);
    expect(data.totalOutstandingDues).toBe(6300);
    expect(data.debtors[0].customerName).toBe('Large Debtor');
    expect(data.debtors[0].amountOwed).toBe(5000);
    expect(data.debtors[1].customerName).toBe('Medium Debtor');
  });

  it('daily_summary: should correctly aggregate daily metrics', async () => {
    await handleAddEntry({ customer_name: 'Customer A', amount: 1000, type: 'credit' }, store);
    await handleAddEntry({ customer_name: 'Customer B', amount: 400, type: 'debit' }, store);

    const res = await handleDailySummary({}, store);
    const data = JSON.parse(res.content[0].text);

    expect(data.totalCreditReceived).toBe(1000);
    expect(data.totalDebitGiven).toBe(400);
    expect(data.netCashFlow).toBe(600);
    expect(data.transactionCount).toBe(2);
  });
});
