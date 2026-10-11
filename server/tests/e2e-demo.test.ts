import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../src/storage/memory.js';
import { VoiceParser } from '../src/ai/parser.js';
import { CollectionsCopilot, CollectionsCopilotResultSchema } from '../src/ai/collectionsCopilot.js';
import { executeTool } from '../src/tools/index.js';

describe('KhataVoice Phase 3 — E2E Voice Demo Test Suite', () => {
  let store: InMemoryStore;
  let parser: VoiceParser;
  let copilot: CollectionsCopilot;
  const merchantId = 'default_merchant';

  beforeEach(() => {
    store = new InMemoryStore();
    // store initializes with backdated synthetic demo kirana data
    parser = new VoiceParser();
    copilot = new CollectionsCopilot();
  });

  it('executes full 3-step voice-first merchant demo journey end-to-end', async () => {
    // =========================================================================
    // STEP 1: Add Udhaar via Natural Voice
    // Merchant: "Ramesh ko 3200 rupaye udhaar."
    // =========================================================================
    const step1Utterance = 'Ramesh ko 3200 rupaye udhaar.';
    const step1Intent = parser.parseLocal(step1Utterance);

    // 1.1 Intent Detection
    expect(step1Intent.toolName).toBe('add_entry');
    expect(step1Intent.arguments.customer_name).toBe('Ramesh');
    expect(step1Intent.arguments.amount).toBe(3200);
    expect(step1Intent.arguments.type).toBe('debit');

    // 1.2 MCP add_entry Execution & Real Ledger Mutation
    const step1McpResult = await executeTool('add_entry', {
      merchant_id: merchantId,
      ...step1Intent.arguments
    }, store);

    expect(step1McpResult.isError).toBe(false);
    const step1Data = JSON.parse(step1McpResult.content[0].text);
    expect(step1Data.success).toBe(true);

    // 1.3 Updated Balance & Ledger Verification
    expect(step1Data.customer.name).toBe('Ramesh');
    expect(step1Data.customer.netBalance).toBe(3200);
    expect(step1Data.customer.totalDebit).toBe(3200);

    // 1.4 Concise Voice Confirmation
    expect(step1Data.voiceMessage).toContain('Ramesh');
    expect(step1Data.voiceMessage).toContain('3,200 rupaye ka udhaar darj ho gaya hai');

    // =========================================================================
    // STEP 2: Balance Inquiry via Natural Voice
    // Merchant: "Ramesh ka balance batao."
    // =========================================================================
    const step2Utterance = 'Ramesh ka balance batao.';
    const step2Intent = parser.parseLocal(step2Utterance);

    // 2.1 Intent Detection
    expect(step2Intent.toolName).toBe('get_balance');
    expect(step2Intent.arguments.customer_name).toBe('Ramesh');

    // 2.2 MCP get_balance Execution
    const step2McpResult = await executeTool('get_balance', {
      merchant_id: merchantId,
      ...step2Intent.arguments
    }, store);

    expect(step2McpResult.isError).toBe(false);
    const step2Data = JSON.parse(step2McpResult.content[0].text);

    // 2.3 Correct Amount & Status
    expect(step2Data.customerName).toBe('Ramesh');
    expect(step2Data.netBalance).toBe(3200);
    expect(step2Data.isStoreWide).toBe(false);

    // 2.4 Concise Hindi/Hinglish Voice Response
    expect(step2Data.voiceMessage).toContain('Ramesh par 3,200 rupaye ka udhaar baaki hai');

    // =========================================================================
    // STEP 3: Main Demo Moment — Collections Copilot
    // Merchant: "Aaj kin logon se paise lene chahiye?"
    // =========================================================================
    const step3Utterance = 'Aaj kin logon se paise lene chahiye?';
    const step3Intent = parser.parseLocal(step3Utterance);

    // 3.1 Collections Copilot Intent Detection
    expect(step3Intent.toolName).toBe('collections_copilot');

    // 3.2 Copilot Execution over Real MCP Tools
    const plan = await copilot.generatePlan({
      merchantId,
      query: step3Utterance
    }, store);

    // 3.3 Verify Exactly 3 MCP Tools Were Invoked
    expect(plan.mcpToolCalls).toHaveLength(3);
    const mcpToolsInvoked = plan.mcpToolCalls.map(c => c.tool);
    expect(mcpToolsInvoked).toEqual(['get_dues', 'daily_summary', 'get_balance']);

    // 3.4 Deterministic Collection Priority Score & Ranking
    const { copilotResult, diagnostics } = plan;
    expect(diagnostics.scoring.length).toBeGreaterThanOrEqual(3);

    // Ramesh (3200 due today, score: 3200 * (1 + 0/30) = 3200)
    // Sharma General Store (3400 due 18 days ago, score: 3400 * (1 + 18/30) = 5440)
    // Sharma General Store should rank P1 due to aging + amount
    expect(copilotResult.priorities.length).toBeGreaterThanOrEqual(2);
    expect(copilotResult.priorities[0].customerName).toBe('Sharma General Store');
    expect(copilotResult.priorities[0].priority).toBe(1);
    expect(copilotResult.priorities[0].amount).toBe(3400);

    // Ramesh must be present in top priorities
    const rameshPriority = copilotResult.priorities.find(p => p.customerName === 'Ramesh');
    expect(rameshPriority).toBeDefined();
    expect(rameshPriority?.amount).toBe(3200);

    // 3.5 Trusted-Data Sanitization & Schema Validation
    expect(diagnostics.validation.passed).toBe(true);
    expect(diagnostics.validation.schemaValid).toBe(true);
    expect(diagnostics.validation.droppedCustomers).toHaveLength(0);
    expect(diagnostics.validation.correctedAmounts).toHaveLength(0);
    expect(() => CollectionsCopilotResultSchema.parse(copilotResult)).not.toThrow();

    // 3.6 Trusted Total Outstanding Calculation
    const duesCall = plan.mcpToolCalls.find(c => c.tool === 'get_dues');
    expect(copilotResult.totalOutstanding).toBe(duesCall?.result.totalOutstandingDues);

    // 3.7 Concise Voice Response for Merchant
    expect(plan.voiceMessage).toContain('pending hai');
    expect(plan.voiceMessage).toContain('Sharma General Store');
    expect(plan.voiceMessage).toContain('Ramesh');
  });

  describe('Privacy Verification: Data Sent to LLM Reasoning Layer', () => {
    it('verifies customer phone numbers are NOT sent to Bedrock', async () => {
      // Seed debtor with phone number
      await store.addEntry({
        merchantId,
        customerName: 'Private Client',
        customerPhone: '+919988776655',
        amount: 2500,
        type: 'debit'
      });

      const plan = await copilot.generatePlan({ merchantId }, store);

      // Verify exact fields projected for Bedrock
      expect(plan.diagnostics.bedrockDebtorFields).toEqual(['customerName', 'amount', 'daysOverdue']);
      expect(plan.diagnostics.bedrockDebtorFields).not.toContain('phone');
      expect(plan.diagnostics.bedrockDebtorFields).not.toContain('customerPhone');

      // Double check in-memory dues debtor has phone, but Copilot strips it before Bedrock
      const duesCall = plan.mcpToolCalls.find(c => c.tool === 'get_dues');
      const debtorWithPhone = duesCall?.result.debtors.find((d: any) => d.customerName === 'Private Client');
      expect(debtorWithPhone?.phone).toBe('+919988776655');

      // Verify copilot result priority items do not leak phone in reasons
      for (const p of plan.copilotResult.priorities) {
        expect(p.reason).not.toContain('+919988776655');
      }
    });

    it('verifies Copilot uses get_dues, daily_summary, and get_balance exactly as documented', async () => {
      const plan = await copilot.generatePlan({ merchantId }, store);

      const toolNames = plan.mcpToolCalls.map(c => c.tool);
      expect(toolNames).toContain('get_dues');
      expect(toolNames).toContain('daily_summary');
      expect(toolNames).toContain('get_balance');

      // Verify get_balance was called in store-wide mode (no customer_name)
      const balanceCall = plan.mcpToolCalls.find(c => c.tool === 'get_balance');
      expect(balanceCall?.result.isStoreWide).toBe(true);

      // Verify daily_summary was called for merchant
      const summaryCall = plan.mcpToolCalls.find(c => c.tool === 'daily_summary');
      expect(summaryCall?.result.merchantId).toBe(merchantId);

      // Verify get_dues was called for merchant with limit
      const duesCall = plan.mcpToolCalls.find(c => c.tool === 'get_dues');
      expect(duesCall?.result.merchantId).toBe(merchantId);
      expect(duesCall?.result.debtors).toBeDefined();
    });
  });
});
