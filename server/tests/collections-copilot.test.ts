import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../src/storage/memory.js';
import {
  CollectionsCopilot,
  CollectionsCopilotResultSchema,
  CollectionsCopilotResult
} from '../src/ai/collectionsCopilot.js';
import { VoiceParser } from '../src/ai/parser.js';

describe('Phase 2: Collections Copilot Agentic Feature Test Suite', () => {
  let store: InMemoryStore;
  let copilot: CollectionsCopilot;
  let parser: VoiceParser;
  const merchantId = 'test_merchant_copilot';

  beforeEach(() => {
    store = new InMemoryStore();
    store.reset();
    copilot = new CollectionsCopilot();
    parser = new VoiceParser();
  });

  describe('1. Intent Detection for Collections Copilot', () => {
    it('recognizes "Aaj kin logon se paise lene chahiye?" as collections_copilot', () => {
      const intent = parser.parseLocal('Aaj kin logon se paise lene chahiye?');
      expect(intent.toolName).toBe('collections_copilot');
      expect(intent.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('recognizes "Who should I collect money from today?" as collections_copilot', () => {
      const intent = parser.parseLocal('Who should I collect money from today?');
      expect(intent.toolName).toBe('collections_copilot');
    });

    it('recognizes "Sabse pehle kis customer ko call karu?" as collections_copilot', () => {
      const intent = parser.parseLocal('Sabse pehle kis customer ko call karu?');
      expect(intent.toolName).toBe('collections_copilot');
    });

    it('recognizes "Kaun sabse zyada overdue hai?" as collections_copilot', () => {
      const intent = parser.parseLocal('Kaun sabse zyada overdue hai?');
      expect(intent.toolName).toBe('collections_copilot');
    });
  });

  describe('2. Scenario: No outstanding dues', () => {
    it('returns empty priorities and clear summary when zero dues exist', async () => {
      // Store has no transactions
      const res = await copilot.generatePlan({ merchantId }, store);

      expect(res.copilotResult.totalOutstanding).toBe(0);
      expect(res.copilotResult.priorities).toHaveLength(0);
      expect(res.copilotResult.summary).toContain('baaki nahi hai');
      expect(res.voiceMessage).toContain('pending nahi hai');

      // Validates against Zod schema
      expect(() => CollectionsCopilotResultSchema.parse(res.copilotResult)).not.toThrow();
    });
  });

  describe('3. Scenario: One customer with dues', () => {
    it('recommends single priority matching exact ledger data', async () => {
      await store.addEntry({
        merchantId,
        customerName: 'Ramesh',
        amount: 3200,
        type: 'debit',
        description: 'Atta & oil boxes'
      });

      const res = await copilot.generatePlan({ merchantId }, store);

      expect(res.copilotResult.totalOutstanding).toBe(3200);
      expect(res.copilotResult.priorities).toHaveLength(1);
      expect(res.copilotResult.priorities[0].customerName).toBe('Ramesh');
      expect(res.copilotResult.priorities[0].amount).toBe(3200);
      expect(res.copilotResult.priorities[0].priority).toBe(1);
      expect(res.copilotResult.priorities[0].reason).toBeTruthy();

      expect(res.voiceMessage).toContain('Ramesh');
      expect(res.voiceMessage).toContain('3,200');
    });
  });

  describe('4. Scenario: Multiple customers and Priority Ordering', () => {
    it('ranks debtors deterministically by risk and amount', async () => {
      // Add 3 debtors with varying amounts
      await store.addEntry({ merchantId, customerName: 'Suresh', amount: 1500, type: 'debit' });
      await store.addEntry({ merchantId, customerName: 'Ramesh', amount: 3200, type: 'debit' });
      await store.addEntry({ merchantId, customerName: 'Mahesh', amount: 800, type: 'debit' });

      const res = await copilot.generatePlan({ merchantId }, store);

      expect(res.copilotResult.totalOutstanding).toBe(5500); // 1500 + 3200 + 800
      expect(res.copilotResult.priorities).toHaveLength(3);

      // Ramesh (3200) must be Priority 1
      expect(res.copilotResult.priorities[0].customerName).toBe('Ramesh');
      expect(res.copilotResult.priorities[0].priority).toBe(1);
      expect(res.copilotResult.priorities[0].amount).toBe(3200);

      // Suresh (1500) must be Priority 2
      expect(res.copilotResult.priorities[1].customerName).toBe('Suresh');
      expect(res.copilotResult.priorities[1].priority).toBe(2);
      expect(res.copilotResult.priorities[1].amount).toBe(1500);

      // Mahesh (800) must be Priority 3
      expect(res.copilotResult.priorities[2].customerName).toBe('Mahesh');
      expect(res.copilotResult.priorities[2].priority).toBe(3);
      expect(res.copilotResult.priorities[2].amount).toBe(800);
    });
  });

  describe('5. Scenario: Missing or insufficient history', () => {
    it('handles debtors with zero or missing daysPending gracefully', async () => {
      await store.addEntry({
        merchantId,
        customerName: 'Walk-in New Client',
        amount: 1000,
        type: 'debit'
      });

      const res = await copilot.generatePlan({ merchantId }, store);
      expect(res.copilotResult.priorities).toHaveLength(1);
      expect(res.copilotResult.priorities[0].reason).toContain('Recent high-value receivable');
    });
  });

  describe('6. Bedrock Structured Output Schema Validation', () => {
    it('validates strictly against CollectionsCopilotResultSchema', () => {
      const validPayload: CollectionsCopilotResult = {
        summary: 'Total ₹8,450 pending. Priority 1 is Ramesh.',
        totalOutstanding: 8450,
        priorities: [
          {
            customerName: 'Ramesh',
            amount: 3200,
            priority: 1,
            reason: '18 days overdue'
          }
        ]
      };

      const parsed = CollectionsCopilotResultSchema.parse(validPayload);
      expect(parsed.totalOutstanding).toBe(8450);
      expect(parsed.priorities[0].customerName).toBe('Ramesh');

      // Invalid schema missing required fields throws error
      expect(() =>
        CollectionsCopilotResultSchema.parse({
          summary: 'Bad payload'
          // missing totalOutstanding and priorities
        })
      ).toThrow();
    });
  });

  describe('7. Anti-Hallucination Guardrail: LLM cannot invent customers', () => {
    it('filters out hallucinated customers not present in real MCP tool results', () => {
      const allowedMap = new Map<string, any>();
      allowedMap.set('ramesh', { customerName: 'Ramesh', amountOwed: 3200, daysPending: 18 });

      // Simulated hallucinated response from an LLM
      const hallucinatedResult: CollectionsCopilotResult = {
        summary: 'Call Ghost Customer immediately',
        totalOutstanding: 5000,
        priorities: [
          {
            customerName: 'Ghost Fabricated Customer',
            amount: 9999,
            priority: 1,
            reason: 'Invented by hallucinating model'
          },
          {
            customerName: 'Ramesh',
            amount: 3200,
            priority: 2,
            reason: 'Real debtor'
          }
        ]
      };

      const sanitized = copilot.sanitizeResultAgainstRealLedger(hallucinatedResult, allowedMap, 3200);

      expect(sanitized.priorities).toHaveLength(1);
      expect(sanitized.priorities[0].customerName).toBe('Ramesh');
      expect(sanitized.priorities[0].amount).toBe(3200);
      expect(sanitized.totalOutstanding).toBe(3200);
    });
  });

  describe('8. Read-only safety guarantee', () => {
    it('never mutates the ledger during copilot execution', async () => {
      await store.addEntry({ merchantId, customerName: 'Pooja', amount: 500, type: 'debit' });

      const txsBefore = await store.getRecentTransactions(merchantId);
      const balBefore = await store.getBalance(merchantId, 'Pooja');

      await copilot.generatePlan({ merchantId }, store);

      const txsAfter = await store.getRecentTransactions(merchantId);
      const balAfter = await store.getBalance(merchantId, 'Pooja');

      expect(txsAfter.length).toBe(txsBefore.length);
      expect(balAfter.netBalance).toBe(balBefore.netBalance);
    });
  });
});
