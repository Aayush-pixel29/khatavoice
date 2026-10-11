import {
  AddEntryInput,
  AddEntryResult,
  BalanceResult,
  Customer,
  DailySummary,
  DailySummaryResult,
  DebtorItem,
  DuesResult,
  GetDuesOptions,
  ILedgerStore,
  Transaction
} from './interface.js';
import { formatINR, voiceAmountINR } from '../utils/currency.js';
import { calculateDaysAgo, getTodayDateString } from '../utils/date.js';

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
}

export class InMemoryStore implements ILedgerStore {
  private transactions: Transaction[] = [];
  private customers: Map<string, Customer> = new Map();
  private dailySummaries: Map<string, DailySummary> = new Map();
  private idempotencyRecords: Map<string, { result: AddEntryResult; expiresAt: number }> = new Map();
  private inFlightRequests: Map<string, Promise<AddEntryResult>> = new Map();

  constructor() {
    this.seedDemoData();
  }

  private getCustomerKey(merchantId: string, customerName: string): string {
    return `${merchantId}#${slugify(customerName)}`;
  }

  private getDailyKey(merchantId: string, date: string): string {
    return `${merchantId}#${date}`;
  }

  public seedDemoData(): void {
    const defaultMerchant = 'default_merchant';
    const today = getTodayDateString();

    const sampleCustomers: Array<{ name: string; phone: string; balance: number; credit: number; debit: number }> = [
      { name: 'Ramesh Kumar', phone: '+919876543210', balance: 750, credit: 500, debit: 1250 },
      { name: 'Sharma General Store', phone: '+919811223344', balance: 3400, credit: 1600, debit: 5000 },
      { name: 'Pooja Verma', phone: '+919922334455', balance: 0, credit: 1500, debit: 1500 },
      { name: 'Sunil Sweets', phone: '+919871122334', balance: 1200, credit: 800, debit: 2000 },
      { name: 'Amit Trader', phone: '+919712345678', balance: 450, credit: 1000, debit: 1450 }
    ];

    for (const c of sampleCustomers) {
      const key = this.getCustomerKey(defaultMerchant, c.name);
      this.customers.set(key, {
        id: `c_${slugify(c.name)}`,
        merchantId: defaultMerchant,
        name: c.name,
        phone: c.phone,
        netBalance: c.balance,
        totalCredit: c.credit,
        totalDebit: c.debit,
        lastTxId: `tx_init_${slugify(c.name)}`,
        lastTxAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    // Seed sample transactions
    const initialTxs: Array<{ name: string; amount: number; type: 'credit' | 'debit'; desc: string }> = [
      { name: 'Ramesh Kumar', amount: 500, type: 'credit', desc: 'UPI repayment' },
      { name: 'Ramesh Kumar', amount: 750, type: 'debit', desc: '5kg Aashirvaad Atta & 1L Mustard Oil' },
      { name: 'Sharma General Store', amount: 3400, type: 'debit', desc: 'Wholesale spices box' },
      { name: 'Pooja Verma', amount: 1500, type: 'credit', desc: 'Full monthly settlement' },
      { name: 'Sunil Sweets', amount: 1200, type: 'debit', desc: 'Dairy milk and sugar crates' },
      { name: 'Amit Trader', amount: 450, type: 'debit', desc: 'Packaging supplies' }
    ];

    let txIdx = 1;
    for (const t of initialTxs) {
      const now = new Date(Date.now() - (6 - txIdx) * 3600000).toISOString();
      this.transactions.push({
        id: `tx_00${txIdx++}`,
        merchantId: defaultMerchant,
        customerName: t.name,
        amount: t.amount,
        type: t.type,
        description: t.desc,
        date: today,
        createdAt: now
      });
    }

    // Compute initial daily summary
    this.recomputeDailySummary(defaultMerchant, today);
  }

  private recomputeDailySummary(merchantId: string, date: string): void {
    const dayTxs = this.transactions.filter(t => t.merchantId === merchantId && t.date === date);
    let totalCredit = 0;
    let totalDebit = 0;

    for (const tx of dayTxs) {
      if (tx.type === 'credit') {
        totalCredit += tx.amount;
      } else {
        totalDebit += tx.amount;
      }
    }

    const key = this.getDailyKey(merchantId, date);
    this.dailySummaries.set(key, {
      date,
      merchantId,
      totalCreditReceived: totalCredit,
      totalDebitGiven: totalDebit,
      netCashFlow: totalCredit - totalDebit,
      transactionCount: dayTxs.length,
      updatedAt: new Date().toISOString()
    });
  }

  public async addEntry(input: AddEntryInput): Promise<AddEntryResult> {
    const merchantId = input.merchantId || 'default_merchant';
    const trimmedName = input.customerName.trim();
    const slug = slugify(trimmedName);

    // 1. Check Idempotency Key (24-hour deduplication window)
    if (input.idempotencyKey) {
      const idempKey = `${merchantId}#${slug}#${input.idempotencyKey}`;
      const existing = this.idempotencyRecords.get(idempKey);
      if (existing && existing.expiresAt > Date.now()) {
        return {
          ...existing.result,
          isDuplicate: true,
          voiceMessage: `[Idempotent] ${existing.result.voiceMessage}`
        };
      }

      // Handle concurrent in-flight requests with identical key
      const inFlight = this.inFlightRequests.get(idempKey);
      if (inFlight) {
        const completed = await inFlight;
        return {
          ...completed,
          isDuplicate: true,
          voiceMessage: `[Idempotent] ${completed.voiceMessage}`
        };
      }

      const executionPromise = this.executeAddEntry(input, merchantId, trimmedName, slug);
      this.inFlightRequests.set(idempKey, executionPromise);
      try {
        const res = await executionPromise;
        this.idempotencyRecords.set(idempKey, {
          result: res,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24-hour policy
        });
        return res;
      } finally {
        this.inFlightRequests.delete(idempKey);
      }
    }

    return this.executeAddEntry(input, merchantId, trimmedName, slug);
  }

  private async executeAddEntry(
    input: AddEntryInput,
    merchantId: string,
    trimmedName: string,
    _slug: string
  ): Promise<AddEntryResult> {
    const date = input.date || getTodayDateString();
    const now = new Date().toISOString();
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Get or initialize customer
    const custKey = this.getCustomerKey(merchantId, trimmedName);
    let customer = this.customers.get(custKey);

    if (!customer) {
      customer = {
        id: `c_${Date.now()}`,
        merchantId,
        name: trimmedName,
        phone: input.customerPhone,
        netBalance: 0,
        totalCredit: 0,
        totalDebit: 0,
        lastTxAt: now,
        updatedAt: now
      };
    } else if (input.customerPhone && !customer.phone) {
      customer.phone = input.customerPhone;
    }

    // Update customer balances
    if (input.type === 'debit') {
      // Udhaar: Customer owes merchant
      customer.netBalance += input.amount;
      customer.totalDebit += input.amount;
    } else {
      // Jama: Customer paid back merchant
      customer.netBalance -= input.amount;
      customer.totalCredit += input.amount;
    }

    customer.lastTxId = txId;
    customer.lastTxAt = now;
    customer.updatedAt = now;
    this.customers.set(custKey, customer);

    // Create immutable transaction
    const transaction: Transaction = {
      id: txId,
      merchantId,
      customerName: trimmedName,
      customerPhone: input.customerPhone || customer.phone,
      amount: input.amount,
      type: input.type,
      description: input.description,
      date,
      createdAt: now
    };

    this.transactions.push(transaction);

    // Update daily summary
    this.recomputeDailySummary(merchantId, date);

    // Voice response generation
    const amtStr = voiceAmountINR(input.amount);
    const balStr = voiceAmountINR(customer.netBalance);
    let voiceMessage: string;

    if (input.type === 'debit') {
      voiceMessage = `${customer.name} ko ${amtStr} ka udhaar darj ho gaya hai. Ab unka kul baki ${balStr} hai.`;
    } else {
      if (customer.netBalance === 0) {
        voiceMessage = `${customer.name} se ${amtStr} jama ho gaye hain. Hisaab pura chukta ho gaya hai.`;
      } else if (customer.netBalance < 0) {
        voiceMessage = `${customer.name} se ${amtStr} jama ho gaye hain. Unka ${voiceAmountINR(Math.abs(customer.netBalance))} advance jama hai.`;
      } else {
        voiceMessage = `${customer.name} se ${amtStr} jama ho gaye hain. Ab baki sirf ${balStr} bacha hai.`;
      }
    }

    return {
      success: true,
      transaction,
      customer,
      voiceMessage
    };
  }

  public async getBalance(merchantId: string, customerName?: string): Promise<BalanceResult> {
    const merchant = merchantId || 'default_merchant';

    if (customerName && customerName.trim().length > 0) {
      const trimmed = customerName.trim();
      const custKey = this.getCustomerKey(merchant, trimmed);
      const customer = this.customers.get(custKey);

      if (!customer) {
        return {
          merchantId: merchant,
          customerName: trimmed,
          isStoreWide: false,
          netBalance: 0,
          totalCredit: 0,
          totalDebit: 0,
          statusText: 'No transactions found',
          voiceMessage: `${trimmed} ka koi purana hisaab nahi mila. Khata shunya hai.`
        };
      }

      let statusText: string;
      let voiceMessage: string;

      if (customer.netBalance > 0) {
        statusText = `Owes ${formatINR(customer.netBalance)}`;
        voiceMessage = `${customer.name} par ${voiceAmountINR(customer.netBalance)} ka udhaar baaki hai.`;
      } else if (customer.netBalance < 0) {
        statusText = `Advance ${formatINR(Math.abs(customer.netBalance))}`;
        voiceMessage = `${customer.name} ka ${voiceAmountINR(Math.abs(customer.netBalance))} advance jama hai.`;
      } else {
        statusText = 'Fully settled';
        voiceMessage = `${customer.name} ka hisaab barabar hai. Koi baaki nahi hai.`;
      }

      return {
        merchantId: merchant,
        customerName: customer.name,
        isStoreWide: false,
        netBalance: customer.netBalance,
        totalCredit: customer.totalCredit,
        totalDebit: customer.totalDebit,
        statusText,
        voiceMessage,
        customer
      };
    }

    // Store-wide aggregate balance
    let totalReceivable = 0;
    let totalPayable = 0;
    let totalCredit = 0;
    let totalDebit = 0;

    for (const c of this.customers.values()) {
      if (c.merchantId === merchant) {
        totalCredit += c.totalCredit;
        totalDebit += c.totalDebit;
        if (c.netBalance > 0) {
          totalReceivable += c.netBalance;
        } else if (c.netBalance < 0) {
          totalPayable += Math.abs(c.netBalance);
        }
      }
    }

    const netStorePosition = totalReceivable - totalPayable;
    const voiceMessage = `Dukan ka kul udhaar lena baaki ${voiceAmountINR(totalReceivable)} hai.`;

    return {
      merchantId: merchant,
      isStoreWide: true,
      netBalance: netStorePosition,
      totalCredit,
      totalDebit,
      statusText: `Total Receivables: ${formatINR(totalReceivable)} | Total Payables: ${formatINR(totalPayable)}`,
      voiceMessage
    };
  }

  public async getDues(merchantId: string, options?: GetDuesOptions): Promise<DuesResult> {
    const merchant = merchantId || 'default_merchant';
    const minAmount = options?.minAmount || 0;
    const limit = options?.limit || 10;

    const debtors: DebtorItem[] = [];
    let totalDues = 0;

    for (const c of this.customers.values()) {
      if (c.merchantId === merchant && c.netBalance > minAmount) {
        debtors.push({
          customerName: c.name,
          phone: c.phone,
          amountOwed: c.netBalance,
          lastTransactionDate: c.lastTxAt,
          daysPending: calculateDaysAgo(c.lastTxAt)
        });
        totalDues += c.netBalance;
      }
    }

    // Sort by largest debtor first
    debtors.sort((a, b) => b.amountOwed - a.amountOwed);
    const limitedDebtors = debtors.slice(0, limit);

    let voiceMessage: string;
    if (debtors.length === 0) {
      voiceMessage = 'Kisi bhi grahak par koi udhaar baaki nahi hai. Sab hisaab saaf hai.';
    } else {
      const topDebtor = debtors[0];
      voiceMessage = `Kul ${debtors.length} grahakon se ${voiceAmountINR(totalDues)} lena baaki hai. Sabse zyada udhaar ${topDebtor.customerName} par ${voiceAmountINR(topDebtor.amountOwed)} hai.`;
    }

    return {
      merchantId: merchant,
      totalOutstandingDues: totalDues,
      debtorCount: debtors.length,
      debtors: limitedDebtors,
      voiceMessage
    };
  }

  public async getDailySummary(merchantId: string, date?: string): Promise<DailySummaryResult> {
    const merchant = merchantId || 'default_merchant';
    const targetDate = date || getTodayDateString();
    const key = this.getDailyKey(merchant, targetDate);

    let summary = this.dailySummaries.get(key);
    if (!summary) {
      this.recomputeDailySummary(merchant, targetDate);
      summary = this.dailySummaries.get(key)!;
    }

    const collectedStr = voiceAmountINR(summary.totalCreditReceived);
    const udhaarStr = voiceAmountINR(summary.totalDebitGiven);
    const voiceMessage = `Aaj kul ${summary.transactionCount} transactions huye. Jama mila ${collectedStr}, aur udhaar diya gaya ${udhaarStr}.`;

    return {
      merchantId: merchant,
      date: targetDate,
      totalCreditReceived: summary.totalCreditReceived,
      totalDebitGiven: summary.totalDebitGiven,
      netCashFlow: summary.netCashFlow,
      transactionCount: summary.transactionCount,
      voiceMessage
    };
  }

  public async getRecentTransactions(merchantId: string, limit: number = 20): Promise<Transaction[]> {
    const merchant = merchantId || 'default_merchant';
    return this.transactions
      .filter(t => t.merchantId === merchant)
      .slice(-limit)
      .reverse();
  }

  public async getAllCustomers(merchantId: string): Promise<Customer[]> {
    const merchant = merchantId || 'default_merchant';
    return Array.from(this.customers.values())
      .filter(c => c.merchantId === merchant)
      .sort((a, b) => b.netBalance - a.netBalance);
  }

  public reset(): void {
    this.transactions = [];
    this.customers.clear();
    this.dailySummaries.clear();
    this.idempotencyRecords.clear();
    this.inFlightRequests.clear();
  }
}
