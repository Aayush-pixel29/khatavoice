export type TransactionType = 'credit' | 'debit';

export interface Transaction {
  id: string;
  merchantId: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  type: TransactionType;
  description?: string;
  date: string; // YYYY-MM-DD
  createdAt: string; // ISO 8601
}

export interface Customer {
  id: string;
  merchantId: string;
  name: string;
  phone?: string;
  /**
   * netBalance > 0: Customer owes merchant (Udhaar / Receivable)
   * netBalance < 0: Merchant owes customer (Advance / Payable)
   * netBalance == 0: Settled
   */
  netBalance: number;
  totalCredit: number; // Total jama received from customer
  totalDebit: number;  // Total udhaar given to customer
  lastTxId?: string;
  lastTxAt: string;
  updatedAt: string;
}

export interface DailySummary {
  date: string; // YYYY-MM-DD
  merchantId: string;
  totalCreditReceived: number; // Total cash/repayments collected
  totalDebitGiven: number;     // Total credit extended
  netCashFlow: number;         // creditReceived - debitGiven
  transactionCount: number;
  updatedAt: string;
}

export interface AddEntryInput {
  merchantId?: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  type: TransactionType;
  description?: string;
  date?: string; // YYYY-MM-DD, defaults to current date in IST/UTC
  idempotencyKey?: string;
}

export interface AddEntryResult {
  success: boolean;
  transaction: Transaction;
  customer: Customer;
  voiceMessage: string;
  isDuplicate?: boolean;
}

export interface BalanceResult {
  merchantId: string;
  customerName?: string;
  isStoreWide: boolean;
  netBalance: number;
  totalCredit: number;
  totalDebit: number;
  statusText: string;
  voiceMessage: string;
  customer?: Customer;
}

export interface DebtorItem {
  customerName: string;
  phone?: string;
  amountOwed: number;
  lastTransactionDate: string;
  daysPending: number;
}

export interface GetDuesOptions {
  minAmount?: number;
  limit?: number;
}

export interface DuesResult {
  merchantId: string;
  totalOutstandingDues: number;
  debtorCount: number;
  debtors: DebtorItem[];
  voiceMessage: string;
}

export interface DailySummaryResult {
  merchantId: string;
  date: string;
  totalCreditReceived: number;
  totalDebitGiven: number;
  netCashFlow: number;
  transactionCount: number;
  voiceMessage: string;
}

export interface ILedgerStore {
  addEntry(input: AddEntryInput): Promise<AddEntryResult>;
  getBalance(merchantId: string, customerName?: string): Promise<BalanceResult>;
  getDues(merchantId: string, options?: GetDuesOptions): Promise<DuesResult>;
  getDailySummary(merchantId: string, date?: string): Promise<DailySummaryResult>;
  getRecentTransactions(merchantId: string, limit?: number): Promise<Transaction[]>;
  getAllCustomers(merchantId: string): Promise<Customer[]>;
}
