export interface Transaction {
  id: string;
  merchantId: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  type: 'credit' | 'debit';
  description?: string;
  date: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  merchantId: string;
  name: string;
  phone?: string;
  netBalance: number;
  totalCredit: number;
  totalDebit: number;
  lastTxId?: string;
  lastTxAt: string;
  updatedAt: string;
}

export interface DailySummary {
  merchantId: string;
  date: string;
  totalCreditReceived: number;
  totalDebitGiven: number;
  netCashFlow: number;
  transactionCount: number;
  voiceMessage?: string;
}

export interface DebtorItem {
  customerName: string;
  phone?: string;
  amountOwed: number;
  lastTransactionDate: string;
  daysPending: number;
}

export interface DuesResult {
  merchantId: string;
  totalOutstandingDues: number;
  debtorCount: number;
  debtors: DebtorItem[];
  voiceMessage: string;
}

export interface DashboardData {
  merchantId: string;
  recentTransactions: Transaction[];
  customers: Customer[];
  dues: DuesResult;
  dailySummary: DailySummary;
}

export interface McpLogEntry {
  id: string;
  timestamp: string;
  direction: 'IN' | 'OUT';
  type: 'SSE_ENDPOINT' | 'JSON_RPC_REQ' | 'JSON_RPC_RES' | 'SSE_MESSAGE';
  method?: string;
  payload: any;
}

export interface PriorityItem {
  customerName: string;
  amount: number;
  priority: number;
  reason: string;
  collectionPriorityScore?: number;
}

export interface CopilotScoredDebtor {
  customerName: string;
  amountOwed: number;
  daysPending: number;
  collectionPriorityScore: number;
}

export interface CopilotDiagnostics {
  reasoningEngine: 'bedrock' | 'deterministic-fallback' | 'none';
  modelId?: string;
  fallbackReason?: string;
  bedrockDebtorFields: string[];
  scoring: CopilotScoredDebtor[];
  validation: {
    passed: boolean;
    schemaValid: boolean;
    droppedCustomers: string[];
    correctedAmounts: string[];
    totalCorrected: boolean;
  };
}

export interface CollectionsCopilotData {
  summary: string;
  totalOutstanding: number;
  priorities: PriorityItem[];
  diagnostics?: CopilotDiagnostics;
}

