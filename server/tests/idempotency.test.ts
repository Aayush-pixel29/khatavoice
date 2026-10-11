import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../src/storage/memory.js';
import { DynamoDBStore } from '../src/storage/dynamodb.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

describe('Blocker 1 & Gate 1: Idempotency Automated Test Suite', () => {
  describe('A. InMemoryStore Idempotency', () => {
    let store: InMemoryStore;
    const merchantId = 'test_merchant_idemp';
    const customerName = 'Rajesh Verma';

    beforeEach(() => {
      store = new InMemoryStore();
      store.reset();
    });

    it('1. First request creates transaction and mutates balance', async () => {
      const beforeBal = await store.getBalance(merchantId, customerName);
      expect(beforeBal.netBalance).toBe(0);

      const res1 = await store.addEntry({
        merchantId,
        customerName,
        amount: 500,
        type: 'debit',
        idempotencyKey: 'key-test-101'
      });

      expect(res1.success).toBe(true);
      expect(res1.isDuplicate).toBeFalsy();
      expect(res1.customer.netBalance).toBe(500);

      const afterBal = await store.getBalance(merchantId, customerName);
      expect(afterBal.netBalance).toBe(500);

      const txs = await store.getRecentTransactions(merchantId);
      expect(txs.length).toBe(1);
    });

    it('2. Same key twice does NOT create another transaction or change balance', async () => {
      const res1 = await store.addEntry({
        merchantId,
        customerName,
        amount: 500,
        type: 'debit',
        idempotencyKey: 'key-test-102'
      });
      expect(res1.isDuplicate).toBeFalsy();
      expect(res1.customer.netBalance).toBe(500);

      // Duplicate invocation with identical key
      const res2 = await store.addEntry({
        merchantId,
        customerName,
        amount: 500,
        type: 'debit',
        idempotencyKey: 'key-test-102'
      });

      expect(res2.success).toBe(true);
      expect(res2.isDuplicate).toBe(true);
      expect(res2.customer.netBalance).toBe(500); // Balance unchanged!
      expect(res2.transaction.id).toBe(res1.transaction.id); // Same original transaction

      const afterBal = await store.getBalance(merchantId, customerName);
      expect(afterBal.netBalance).toBe(500); // Verified balance unchanged

      const txs = await store.getRecentTransactions(merchantId);
      expect(txs.length).toBe(1); // Exactly 1 transaction recorded
    });

    it('3. Same key 3 times still results in exactly 1 transaction and unchanged balance', async () => {
      const key = 'key-test-103';
      const res1 = await store.addEntry({ merchantId, customerName, amount: 400, type: 'debit', idempotencyKey: key });
      const res2 = await store.addEntry({ merchantId, customerName, amount: 400, type: 'debit', idempotencyKey: key });
      const res3 = await store.addEntry({ merchantId, customerName, amount: 400, type: 'debit', idempotencyKey: key });

      expect(res1.isDuplicate).toBeFalsy();
      expect(res2.isDuplicate).toBe(true);
      expect(res3.isDuplicate).toBe(true);

      const bal = await store.getBalance(merchantId, customerName);
      expect(bal.netBalance).toBe(400);

      const txs = await store.getRecentTransactions(merchantId);
      expect(txs.length).toBe(1);
    });

    it('4. Different keys create separate transactions and mutate balance correctly', async () => {
      const res1 = await store.addEntry({
        merchantId,
        customerName,
        amount: 500,
        type: 'debit',
        idempotencyKey: 'key-diff-1'
      });
      const res2 = await store.addEntry({
        merchantId,
        customerName,
        amount: 250,
        type: 'debit',
        idempotencyKey: 'key-diff-2'
      });

      expect(res1.isDuplicate).toBeFalsy();
      expect(res2.isDuplicate).toBeFalsy();

      const bal = await store.getBalance(merchantId, customerName);
      expect(bal.netBalance).toBe(750); // 500 + 250

      const txs = await store.getRecentTransactions(merchantId);
      expect(txs.length).toBe(2);
    });

    it('5. Concurrent duplicate requests execute exactly once without race conditions', async () => {
      const concurrentKey = 'key-concurrent-batch';
      const promises = Array.from({ length: 5 }, () =>
        store.addEntry({
          merchantId,
          customerName,
          amount: 300,
          type: 'debit',
          idempotencyKey: concurrentKey
        })
      );

      const results = await Promise.all(promises);
      const successfulCreations = results.filter(r => !r.isDuplicate);
      const duplicateResponses = results.filter(r => r.isDuplicate);

      expect(successfulCreations.length).toBe(1);
      expect(duplicateResponses.length).toBe(4);

      const finalBal = await store.getBalance(merchantId, customerName);
      expect(finalBal.netBalance).toBe(300); // exactly one mutation!

      const txs = await store.getRecentTransactions(merchantId);
      expect(txs.length).toBe(1);
    });
  });

  describe('B. DynamoDBStore Atomic Idempotency', () => {
    let ddbStore: DynamoDBStore;
    const merchantId = 'test_merchant_ddb';
    const customerName = 'Priya Sharma';
    const slug = 'priya_sharma';

    // Simulated DynamoDB table state
    const tableState = new Map<string, any>();

    beforeEach(() => {
      tableState.clear();

      // Mock DynamoDBClient that enforces ConditionExpression: 'attribute_not_exists(PK)' on TransactWrite
      const mockClient = {
        send: async (command: any) => {
          const cmdName = command.constructor?.name || '';

          if (cmdName === 'TransactWriteCommand') {
            const items = command.input?.TransactItems || [];
            // Check condition expressions
            for (const item of items) {
              if (item.Put) {
                const key = `${item.Put.Item.PK}#${item.Put.Item.SK}`;
                if (item.Put.ConditionExpression?.includes('attribute_not_exists') && tableState.has(key)) {
                  const error: any = new Error('Transaction cancelled, condition check failed');
                  error.name = 'TransactionCanceledException';
                  error.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }];
                  throw error;
                }
              }
            }

            // Apply mutations atomically
            for (const item of items) {
              if (item.Put) {
                const key = `${item.Put.Item.PK}#${item.Put.Item.SK}`;
                tableState.set(key, { ...item.Put.Item });
              }
              if (item.Update) {
                const key = `${item.Update.Key.PK}#${item.Update.Key.SK}`;
                const existing = tableState.get(key) || {
                  PK: item.Update.Key.PK,
                  SK: item.Update.Key.SK,
                  net_balance: 0,
                  total_credit: 0,
                  total_debit: 0
                };
                const values = item.Update.ExpressionAttributeValues || {};
                if (values[':netChange'] !== undefined) existing.net_balance += values[':netChange'];
                if (values[':creditChange'] !== undefined) existing.total_credit += values[':creditChange'];
                if (values[':debitChange'] !== undefined) existing.total_debit += values[':debitChange'];
                if (values[':txId']) existing.last_tx_id = values[':txId'];
                if (values[':cName']) existing.customer_name = values[':cName'];
                tableState.set(key, existing);
              }
            }
            return {};
          }

          if (cmdName === 'GetCommand') {
            const key = `${command.input.Key.PK}#${command.input.Key.SK}`;
            return { Item: tableState.get(key) };
          }

          if (cmdName === 'QueryCommand') {
            const pk = command.input.ExpressionAttributeValues[':pk'];
            const skPrefix = command.input.ExpressionAttributeValues[':skPrefix'];
            const items: any[] = [];
            for (const [k, v] of tableState.entries()) {
              if (k.startsWith(`${pk}#${skPrefix}`)) {
                items.push(v);
              }
            }
            return { Items: items };
          }

          return {};
        }
      } as unknown as DynamoDBClient;

      ddbStore = new DynamoDBStore('KhataVoiceTable', mockClient);
    });

    it('1. DynamoDB first request writes transaction and atomically updates balance', async () => {
      const res1 = await ddbStore.addEntry({
        merchantId,
        customerName,
        amount: 800,
        type: 'debit',
        idempotencyKey: 'ddb-key-1'
      });

      expect(res1.success).toBe(true);
      expect(res1.isDuplicate).toBeFalsy();
      expect(res1.customer.netBalance).toBe(800);

      const bal = await ddbStore.getBalance(merchantId, customerName);
      expect(bal.netBalance).toBe(800);

      const txs = await ddbStore.getRecentTransactions(merchantId);
      expect(txs.length).toBe(1);
    });

    it('2. DynamoDB duplicate key triggers ConditionalCheckFailed and aborts all mutations', async () => {
      const key = 'ddb-key-dup';
      const res1 = await ddbStore.addEntry({
        merchantId,
        customerName,
        amount: 600,
        type: 'debit',
        idempotencyKey: key
      });
      expect(res1.isDuplicate).toBeFalsy();
      expect(res1.customer.netBalance).toBe(600);

      // Repeated request with identical key
      const res2 = await ddbStore.addEntry({
        merchantId,
        customerName,
        amount: 600,
        type: 'debit',
        idempotencyKey: key
      });

      expect(res2.success).toBe(true);
      expect(res2.isDuplicate).toBe(true);
      expect(res2.customer.netBalance).toBe(600); // Balance unchanged!
      expect(res2.transaction.id).toBe(res1.transaction.id);

      // Third attempt with identical key
      const res3 = await ddbStore.addEntry({
        merchantId,
        customerName,
        amount: 600,
        type: 'debit',
        idempotencyKey: key
      });
      expect(res3.isDuplicate).toBe(true);
      expect(res3.customer.netBalance).toBe(600);

      const bal = await ddbStore.getBalance(merchantId, customerName);
      expect(bal.netBalance).toBe(600); // Verified balance unchanged!

      const txs = await ddbStore.getRecentTransactions(merchantId);
      expect(txs.length).toBe(1); // Verified only 1 transaction recorded!
    });

    it('3. DynamoDB different keys create separate transactions', async () => {
      const res1 = await ddbStore.addEntry({
        merchantId,
        customerName,
        amount: 500,
        type: 'debit',
        idempotencyKey: 'ddb-key-a'
      });
      const res2 = await ddbStore.addEntry({
        merchantId,
        customerName,
        amount: 300,
        type: 'debit',
        idempotencyKey: 'ddb-key-b'
      });

      expect(res1.isDuplicate).toBeFalsy();
      expect(res2.isDuplicate).toBeFalsy();

      const bal = await ddbStore.getBalance(merchantId, customerName);
      expect(bal.netBalance).toBe(800);

      const txs = await ddbStore.getRecentTransactions(merchantId);
      expect(txs.length).toBe(2);
    });

    it('4. DynamoDB concurrent duplicate requests execute exactly once and abort competitors', async () => {
      const concurrentKey = 'ddb-concurrent-batch';
      const promises = Array.from({ length: 4 }, () =>
        ddbStore.addEntry({
          merchantId,
          customerName: 'Anil Gupta',
          amount: 450,
          type: 'debit',
          idempotencyKey: concurrentKey
        })
      );

      const results = await Promise.all(promises);
      const successfulCreations = results.filter(r => !r.isDuplicate);
      const duplicateResponses = results.filter(r => r.isDuplicate);

      expect(successfulCreations.length).toBe(1);
      expect(duplicateResponses.length).toBe(3);

      const bal = await ddbStore.getBalance(merchantId, 'Anil Gupta');
      expect(bal.netBalance).toBe(450); // Exactly one mutation!
    });
  });
});
