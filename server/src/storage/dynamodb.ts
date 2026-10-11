import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand
} from '@aws-sdk/lib-dynamodb';
import {
  AddEntryInput,
  AddEntryResult,
  BalanceResult,
  Customer,
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

export class DynamoDBStore implements ILedgerStore {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(tableName?: string, clientOrDoc?: DynamoDBClient | DynamoDBDocumentClient | any) {
    this.tableName = tableName || process.env.DYNAMODB_TABLE_NAME || 'KhataVoiceTable';
    if (clientOrDoc && typeof clientOrDoc.send === 'function' && !(clientOrDoc instanceof DynamoDBClient)) {
      this.docClient = clientOrDoc as DynamoDBDocumentClient;
    } else {
      const rawClient = (clientOrDoc as DynamoDBClient) || new DynamoDBClient({
        region: process.env.AWS_REGION || 'us-east-1'
      });
      this.docClient = DynamoDBDocumentClient.from(rawClient, {
        marshallOptions: { removeUndefinedValues: true }
      });
    }
  }

  public async addEntry(input: AddEntryInput): Promise<AddEntryResult> {
    const merchantId = input.merchantId || 'default_merchant';
    const trimmedName = input.customerName.trim();
    const slug = slugify(trimmedName);
    const date = input.date || getTodayDateString();
    const now = new Date().toISOString();
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const isDebit = input.type === 'debit';
    const netChange = isDebit ? input.amount : -input.amount;
    const debitChange = isDebit ? input.amount : 0;
    const creditChange = isDebit ? 0 : input.amount;

    const txItem = {
      PK: `MERCHANT#${merchantId}`,
      SK: `TX#${now}#${txId}`,
      entity_type: 'TRANSACTION',
      tx_id: txId,
      merchantId,
      customerName: trimmedName,
      customerSlug: slug,
      customerPhone: input.customerPhone,
      amount: input.amount,
      type: input.type,
      description: input.description,
      date,
      createdAt: now,
      GSI1PK: `MERCHANT#${merchantId}#CUSTOMER#${slug}`,
      GSI1SK: `TX#${now}`,
      GSI3PK: `MERCHANT#${merchantId}#DATE#${date}`,
      GSI3SK: `TX#${now}`
    };

    const idempKey = input.idempotencyKey;
    const idempPK = `MERCHANT#${merchantId}`;
    const idempSK = `IDEMP#${slug}#${idempKey}`;
    const ttl = Math.floor(Date.now() / 1000) + 24 * 3600; // 24-hour TTL

    // 1. Transaction Item
    // 2. Customer Atomic Update
    // 3. Daily Summary Atomic Update
    // 4. (Optional) Idempotency Record with ConditionExpression
    const transactItems: any[] = [
      {
        Put: {
          TableName: this.tableName,
          Item: txItem
        }
      },
      {
        Update: {
          TableName: this.tableName,
          Key: {
            PK: `MERCHANT#${merchantId}`,
            SK: `CUSTOMER#${slug}`
          },
          UpdateExpression: `
            SET entity_type = :entityType,
                customer_name = :cName,
                customer_phone = if_not_exists(customer_phone, :cPhone),
                last_tx_id = :txId,
                last_tx_at = :now,
                updated_at = :now
            ADD net_balance :netChange,
                total_credit :creditChange,
                total_debit :debitChange
          `,
          ExpressionAttributeValues: {
            ':entityType': 'CUSTOMER',
            ':cName': trimmedName,
            ':cPhone': input.customerPhone || null,
            ':txId': txId,
            ':now': now,
            ':netChange': netChange,
            ':creditChange': creditChange,
            ':debitChange': debitChange
          }
        }
      },
      {
        Update: {
          TableName: this.tableName,
          Key: {
            PK: `MERCHANT#${merchantId}`,
            SK: `DAILY#${date}`
          },
          UpdateExpression: `
            SET entity_type = :dailyType,
                #dDate = :dateVal,
                updated_at = :now
            ADD total_credit_received :creditChange,
                total_debit_given :debitChange,
                transaction_count :one
          `,
          ExpressionAttributeNames: {
            '#dDate': 'date'
          },
          ExpressionAttributeValues: {
            ':dailyType': 'DAILY_SUMMARY',
            ':dateVal': date,
            ':now': now,
            ':creditChange': creditChange,
            ':debitChange': debitChange,
            ':one': 1
          }
        }
      }
    ];

    if (idempKey) {
      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: {
            PK: idempPK,
            SK: idempSK,
            entity_type: 'IDEMPOTENCY_RECORD',
            merchantId,
            customerSlug: slug,
            customerName: trimmedName,
            idempotencyKey: idempKey,
            tx_id: txId,
            amount: input.amount,
            type: input.type,
            description: input.description,
            date,
            createdAt: now,
            ttl
          },
          ConditionExpression: 'attribute_not_exists(PK)'
        }
      });
    }

    try {
      await this.docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (err: any) {
      const isConditionalCheckFailed =
        err?.name === 'TransactionCanceledException' &&
        (err.CancellationReasons?.some((r: any) => r?.Code === 'ConditionalCheckFailed') ||
         err?.message?.includes('ConditionalCheckFailed'));

      if (isConditionalCheckFailed && idempKey) {
        // Atomic duplicate caught! Fetch existing idempotency record and customer
        const [idempRes, custRes] = await Promise.all([
          this.docClient.send(new GetCommand({
            TableName: this.tableName,
            Key: { PK: idempPK, SK: idempSK }
          })),
          this.docClient.send(new GetCommand({
            TableName: this.tableName,
            Key: { PK: `MERCHANT#${merchantId}`, SK: `CUSTOMER#${slug}` }
          }))
        ]);

        const existingIdemp = idempRes.Item || {};
        const existingCust = custRes.Item || {};
        const existingCustomer: Customer = {
          id: existingCust.customer_id || `c_${slug}`,
          merchantId,
          name: existingCust.customer_name || trimmedName,
          phone: existingCust.customer_phone,
          netBalance: existingCust.net_balance ?? 0,
          totalCredit: existingCust.total_credit ?? 0,
          totalDebit: existingCust.total_debit ?? 0,
          lastTxId: existingCust.last_tx_id || existingIdemp.tx_id,
          lastTxAt: existingCust.last_tx_at || existingIdemp.createdAt || now,
          updatedAt: existingCust.updated_at || now
        };

        const existingTransaction: Transaction = {
          id: existingIdemp.tx_id || 'tx_cached',
          merchantId,
          customerName: trimmedName,
          customerPhone: input.customerPhone || existingCustomer.phone,
          amount: existingIdemp.amount ?? input.amount,
          type: existingIdemp.type ?? input.type,
          description: existingIdemp.description ?? input.description,
          date: existingIdemp.date ?? date,
          createdAt: existingIdemp.createdAt || now
        };

        const amtStr = voiceAmountINR(existingTransaction.amount);
        const balStr = voiceAmountINR(existingCustomer.netBalance);
        const voiceMessage = `[Idempotent] ${trimmedName} ke liye pehle hi ${amtStr} ka record ho chuka hai. Kul baki: ${balStr}.`;

        return {
          success: true,
          transaction: existingTransaction,
          customer: existingCustomer,
          voiceMessage,
          isDuplicate: true
        };
      }

      throw err;
    }

    // Fetch refreshed customer balance
    const custRes = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `MERCHANT#${merchantId}`, SK: `CUSTOMER#${slug}` }
    }));

    const customerItem = custRes.Item || {};
    const updatedCustomer: Customer = {
      id: customerItem.customer_id || `c_${slug}`,
      merchantId,
      name: trimmedName,
      phone: customerItem.customer_phone,
      netBalance: customerItem.net_balance ?? netChange,
      totalCredit: customerItem.total_credit ?? creditChange,
      totalDebit: customerItem.total_debit ?? debitChange,
      lastTxId: txId,
      lastTxAt: now,
      updatedAt: now
    };

    const amtStr = voiceAmountINR(input.amount);
    const balStr = voiceAmountINR(updatedCustomer.netBalance);
    let voiceMessage: string;

    if (isDebit) {
      voiceMessage = `${updatedCustomer.name} ko ${amtStr} ka udhaar darj ho gaya hai. Ab unka kul baki ${balStr} hai.`;
    } else {
      if (updatedCustomer.netBalance <= 0) {
        voiceMessage = `${updatedCustomer.name} se ${amtStr} jama ho gaye hain. Hisaab pura chukta ho gaya hai.`;
      } else {
        voiceMessage = `${updatedCustomer.name} se ${amtStr} jama ho gaye hain. Ab baki sirf ${balStr} bacha hai.`;
      }
    }

    const transaction: Transaction = {
      id: txId,
      merchantId,
      customerName: trimmedName,
      customerPhone: input.customerPhone,
      amount: input.amount,
      type: input.type,
      description: input.description,
      date,
      createdAt: now
    };

    return {
      success: true,
      transaction,
      customer: updatedCustomer,
      voiceMessage
    };
  }

  public async getBalance(merchantId: string, customerName?: string): Promise<BalanceResult> {
    const merchant = merchantId || 'default_merchant';

    if (customerName && customerName.trim().length > 0) {
      const trimmed = customerName.trim();
      const slug = slugify(trimmed);

      const res = await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: `MERCHANT#${merchant}`, SK: `CUSTOMER#${slug}` }
      }));

      if (!res.Item) {
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

      const item = res.Item;
      const netBalance = item.net_balance || 0;
      let statusText: string;
      let voiceMessage: string;

      if (netBalance > 0) {
        statusText = `Owes ${formatINR(netBalance)}`;
        voiceMessage = `${item.customer_name} par ${voiceAmountINR(netBalance)} ka udhaar baaki hai.`;
      } else if (netBalance < 0) {
        statusText = `Advance ${formatINR(Math.abs(netBalance))}`;
        voiceMessage = `${item.customer_name} ka ${voiceAmountINR(Math.abs(netBalance))} advance jama hai.`;
      } else {
        statusText = 'Fully settled';
        voiceMessage = `${item.customer_name} ka hisaab barabar hai. Koi baaki nahi hai.`;
      }

      return {
        merchantId: merchant,
        customerName: item.customer_name,
        isStoreWide: false,
        netBalance,
        totalCredit: item.total_credit || 0,
        totalDebit: item.total_debit || 0,
        statusText,
        voiceMessage,
        customer: {
          id: item.customer_id || `c_${slug}`,
          merchantId: merchant,
          name: item.customer_name,
          phone: item.customer_phone,
          netBalance,
          totalCredit: item.total_credit || 0,
          totalDebit: item.total_debit || 0,
          lastTxAt: item.last_tx_at || '',
          updatedAt: item.updated_at || ''
        }
      };
    }

    // Store-wide balance: Query all customer items
    const customers = await this.getAllCustomers(merchant);
    let totalReceivable = 0;
    let totalPayable = 0;
    let totalCredit = 0;
    let totalDebit = 0;

    for (const c of customers) {
      totalCredit += c.totalCredit;
      totalDebit += c.totalDebit;
      if (c.netBalance > 0) {
        totalReceivable += c.netBalance;
      } else if (c.netBalance < 0) {
        totalPayable += Math.abs(c.netBalance);
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

    const customers = await this.getAllCustomers(merchant);
    const debtors: DebtorItem[] = [];
    let totalDues = 0;

    for (const c of customers) {
      if (c.netBalance > minAmount) {
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

    debtors.sort((a, b) => b.amountOwed - a.amountOwed);
    const limited = debtors.slice(0, limit);

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
      debtors: limited,
      voiceMessage
    };
  }

  public async getDailySummary(merchantId: string, date?: string): Promise<DailySummaryResult> {
    const merchant = merchantId || 'default_merchant';
    const targetDate = date || getTodayDateString();

    const res = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `MERCHANT#${merchant}`, SK: `DAILY#${targetDate}` }
    }));

    const item = res.Item || {};
    const totalCredit = item.total_credit_received || 0;
    const totalDebit = item.total_debit_given || 0;
    const count = item.transaction_count || 0;
    const netCash = totalCredit - totalDebit;

    const collectedStr = voiceAmountINR(totalCredit);
    const udhaarStr = voiceAmountINR(totalDebit);
    const voiceMessage = `Aaj kul ${count} transactions huye. Jama mila ${collectedStr}, aur udhaar diya gaya ${udhaarStr}.`;

    return {
      merchantId: merchant,
      date: targetDate,
      totalCreditReceived: totalCredit,
      totalDebitGiven: totalDebit,
      netCashFlow: netCash,
      transactionCount: count,
      voiceMessage
    };
  }

  public async getRecentTransactions(merchantId: string, limit: number = 20): Promise<Transaction[]> {
    const merchant = merchantId || 'default_merchant';

    const res = await this.docClient.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `MERCHANT#${merchant}`,
        ':skPrefix': 'TX#'
      },
      ScanIndexForward: false, // Descending (newest first)
      Limit: limit
    }));

    return (res.Items || []).map(item => ({
      id: item.tx_id,
      merchantId: item.merchantId,
      customerName: item.customerName,
      customerPhone: item.customerPhone,
      amount: item.amount,
      type: item.type,
      description: item.description,
      date: item.date,
      createdAt: item.createdAt
    }));
  }

  public async getAllCustomers(merchantId: string): Promise<Customer[]> {
    const merchant = merchantId || 'default_merchant';

    const res = await this.docClient.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `MERCHANT#${merchant}`,
        ':skPrefix': 'CUSTOMER#'
      }
    }));

    return (res.Items || []).map(item => ({
      id: item.customer_id || item.SK.replace('CUSTOMER#', 'c_'),
      merchantId: merchant,
      name: item.customer_name,
      phone: item.customer_phone,
      netBalance: item.net_balance || 0,
      totalCredit: item.total_credit || 0,
      totalDebit: item.total_debit || 0,
      lastTxId: item.last_tx_id,
      lastTxAt: item.last_tx_at || '',
      updatedAt: item.updated_at || ''
    }));
  }
}
