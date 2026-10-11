import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { ILedgerStore } from '../storage/interface.js';
import { executeTool } from '../tools/index.js';
import { voiceAmountINR, formatINR } from '../utils/currency.js';

export const CollectionsPriorityItemSchema = z.object({
  customerName: z.string().min(1),
  amount: z.number().nonnegative(),
  priority: z.number().int().positive(),
  reason: z.string().min(1)
});

export type CollectionsPriorityItem = z.infer<typeof CollectionsPriorityItemSchema>;

export const CollectionsCopilotResultSchema = z.object({
  summary: z.string().min(1),
  totalOutstanding: z.number().nonnegative(),
  priorities: z.array(CollectionsPriorityItemSchema)
});

export type CollectionsCopilotResult = z.infer<typeof CollectionsCopilotResultSchema>;

export interface CopilotPlanOptions {
  merchantId?: string;
  query?: string;
}

export interface CopilotPlanResponse {
  copilotResult: CollectionsCopilotResult;
  voiceMessage: string;
  mcpToolCalls: Array<{ tool: string; result: any }>;
}

export class CollectionsCopilot {
  private bedrockClient: BedrockRuntimeClient | null = null;
  private modelId: string;

  constructor(client?: BedrockRuntimeClient) {
    this.modelId = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
    if (client) {
      this.bedrockClient = client;
    } else if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.bedrockClient = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || 'us-east-1'
      });
    }
  }

  /**
   * Main entrypoint for Collections Copilot recommendation generation.
   * Invokes REAL MCP tools (get_dues, daily_summary, get_balance),
   * applies deterministic calculations outside LLM,
   * passes to Bedrock reasoning layer with anti-hallucination validation.
   */
  public async generatePlan(
    options: CopilotPlanOptions,
    store: ILedgerStore
  ): Promise<CopilotPlanResponse> {
    const merchantId = options.merchantId || 'default_merchant';
    const userQuery = options.query || 'Who should I collect money from today?';

    // 1. Execute REAL MCP Tools
    const mcpToolCalls: Array<{ tool: string; result: any }> = [];

    // Tool Call 1: get_dues
    const duesRaw = await executeTool('get_dues', { merchant_id: merchantId, limit: 10 }, store);
    const duesResult = JSON.parse(duesRaw.content[0].text);
    mcpToolCalls.push({ tool: 'get_dues', result: duesResult });

    // Tool Call 2: daily_summary
    const summaryRaw = await executeTool('daily_summary', { merchant_id: merchantId }, store);
    const summaryResult = JSON.parse(summaryRaw.content[0].text);
    mcpToolCalls.push({ tool: 'daily_summary', result: summaryResult });

    // Tool Call 3: get_balance (store-wide)
    const balanceRaw = await executeTool('get_balance', { merchant_id: merchantId }, store);
    const balanceResult = JSON.parse(balanceRaw.content[0].text);
    mcpToolCalls.push({ tool: 'get_balance', result: balanceResult });

    // 2. Deterministic calculations outside LLM
    const totalOutstanding = duesResult.totalOutstandingDues ?? 0;
    const realDebtors: Array<{
      customerName: string;
      amountOwed: number;
      phone?: string;
      daysPending: number;
      lastTransactionDate: string;
    }> = duesResult.debtors || [];

    // Rule: Handle zero outstanding dues deterministically
    if (realDebtors.length === 0 || totalOutstanding === 0) {
      const emptyResult: CollectionsCopilotResult = {
        summary: 'Kisi bhi grahak par koi udhaar baaki nahi hai. Sab hisaab saaf hai.',
        totalOutstanding: 0,
        priorities: []
      };
      return {
        copilotResult: emptyResult,
        voiceMessage: 'Dukan par koi bhi udhaar pending nahi hai. Kisi se paise lene ki zaroorat nahi hai.',
        mcpToolCalls
      };
    }

    // 3. Deterministic Priority Ranking (Amount & Overdue Days Heuristic)
    // Score = amountOwed * (1 + (daysPending / 30))
    const scoredDebtors = [...realDebtors].map(d => {
      const days = typeof d.daysPending === 'number' && !isNaN(d.daysPending) ? d.daysPending : 0;
      const score = d.amountOwed * (1 + days / 30);
      return { ...d, days, score };
    });
    scoredDebtors.sort((a, b) => b.score - a.score);

    // Pick top 3 priorities
    const topDebtors = scoredDebtors.slice(0, 3);

    // Build map of allowed real customer names for strict anti-hallucination verification
    const allowedCustomerMap = new Map<string, typeof realDebtors[0]>();
    for (const d of realDebtors) {
      allowedCustomerMap.set(d.customerName.toLowerCase().trim(), d);
    }

    let copilotResult: CollectionsCopilotResult;

    // 4. Bedrock Reasoning Layer
    if (this.bedrockClient) {
      try {
        copilotResult = await this.reasonWithBedrock(userQuery, totalOutstanding, topDebtors, allowedCustomerMap);
      } catch (err) {
        console.warn('[CollectionsCopilot] Bedrock inference failed, falling back to deterministic reasoning:', err);
        copilotResult = this.deterministicReasoning(totalOutstanding, topDebtors);
      }
    } else {
      copilotResult = this.deterministicReasoning(totalOutstanding, topDebtors);
    }

    // 5. Anti-Hallucination Guardrail: Enforce strict customer fidelity
    copilotResult = this.sanitizeResultAgainstRealLedger(copilotResult, allowedCustomerMap, totalOutstanding);

    // 6. Generate concise voice response
    const voiceMessage = this.generateVoiceMessage(copilotResult);

    return {
      copilotResult,
      voiceMessage,
      mcpToolCalls
    };
  }

  /**
   * Invokes Amazon Bedrock Converse API for explainable structured reasoning.
   */
  private async reasonWithBedrock(
    query: string,
    totalOutstanding: number,
    topDebtors: Array<{ customerName: string; amountOwed: number; days: number }>,
    allowedCustomerMap: Map<string, any>
  ): Promise<CollectionsCopilotResult> {
    if (!this.bedrockClient) {
      throw new Error('Bedrock client uninitialized');
    }

    const systemPrompt = `You are the KhataVoice Collections Copilot for Indian small retailers.
Your role is to analyze outstanding customer credit from the business ledger and produce priority recommendations.

STRICT PROTOCOL RULES:
1. ONLY reason over the customer records provided in the context below.
2. NEVER INVENT, FABRICATE, OR HALLUCINATE ANY CUSTOMER NAMES OR AMOUNTS.
3. Total outstanding MUST be strictly ${totalOutstanding}.
4. Provide concise, explainable reasoning for why each customer is prioritized (e.g. amount size, days pending).
5. Output MUST be ONLY valid JSON matching this schema:
{
  "summary": "Short bilingual explanation of collection priorities",
  "totalOutstanding": ${totalOutstanding},
  "priorities": [
    {
      "customerName": "Exact customer name from context",
      "amount": exact amount as number,
      "priority": 1,
      "reason": "Explainable reason"
    }
  ]
}`;

    const contextMessage = `User Query: "${query}"

LEDGER CONTEXT (Returned from MCP tools):
Total Store Outstanding: ₹${totalOutstanding}
Debtors for Collection:
${JSON.stringify(topDebtors.map(d => ({
  customerName: d.customerName,
  amount: d.amountOwed,
  daysOverdue: d.days
})), null, 2)}

Produce the JSON object now.`;

    const command = new ConverseCommand({
      modelId: this.modelId,
      messages: [
        {
          role: 'user',
          content: [{ text: contextMessage }]
        }
      ],
      system: [{ text: systemPrompt }]
    });

    const response = await this.bedrockClient.send(command);
    const contentList = response.output?.message?.content || [];
    const textOutput = contentList.map(c => c.text || '').join('').trim();

    // Parse JSON
    const jsonMatch = textOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in Bedrock response');
    }

    const rawParsed = JSON.parse(jsonMatch[0]);
    // Validate with Zod schema
    const validated = CollectionsCopilotResultSchema.parse(rawParsed);

    return validated;
  }

  /**
   * Deterministic local reasoning engine ensuring 100% reliability offline
   * and in test environments without external AWS Bedrock dependencies.
   */
  public deterministicReasoning(
    totalOutstanding: number,
    topDebtors: Array<{ customerName: string; amountOwed: number; days: number }>
  ): CollectionsCopilotResult {
    const priorities: CollectionsPriorityItem[] = topDebtors.map((d, idx) => {
      let reason: string;
      if (d.days > 0) {
        reason = `${d.days} days overdue, highest balance of ${formatINR(d.amountOwed)}`;
      } else {
        reason = `Recent high-value receivable of ${formatINR(d.amountOwed)}`;
      }

      return {
        customerName: d.customerName,
        amount: d.amountOwed,
        priority: idx + 1,
        reason
      };
    });

    const first = priorities[0];
    const second = priorities[1];
    let summary: string;

    if (first && second) {
      summary = `Total ${formatINR(totalOutstanding)} pending. Prioritize collecting ${formatINR(first.amount)} from ${first.customerName} (${first.reason}), followed by ${second.customerName} (${formatINR(second.amount)}).`;
    } else if (first) {
      summary = `Total ${formatINR(totalOutstanding)} pending. Top priority is ${first.customerName} for ${formatINR(first.amount)} (${first.reason}).`;
    } else {
      summary = `Total ${formatINR(totalOutstanding)} pending across store credit accounts.`;
    }

    return {
      summary,
      totalOutstanding,
      priorities
    };
  }

  /**
   * Anti-Hallucination & Schema Guardrail.
   * Filters out any priority item whose customerName was not returned by MCP tools.
   */
  public sanitizeResultAgainstRealLedger(
    result: CollectionsCopilotResult,
    allowedCustomerMap: Map<string, any>,
    realTotalOutstanding: number
  ): CollectionsCopilotResult {
    const validPriorities: CollectionsPriorityItem[] = [];

    let rank = 1;
    for (const item of result.priorities) {
      const match = allowedCustomerMap.get(item.customerName.toLowerCase().trim());
      if (match) {
        validPriorities.push({
          customerName: match.customerName, // Use canonical name from ledger
          amount: match.amountOwed,         // Use canonical amount from ledger
          priority: rank++,
          reason: item.reason || `${match.daysPending || 0} days overdue`
        });
      }
    }

    return {
      summary: result.summary,
      totalOutstanding: realTotalOutstanding,
      priorities: validPriorities
    };
  }

  /**
   * Generates a concise, voice-friendly response in Hindi/Hinglish.
   */
  public generateVoiceMessage(result: CollectionsCopilotResult): string {
    if (result.priorities.length === 0) {
      return 'Dukan par koi bhi udhaar pending nahi hai. Kisi se paise lene ki zaroorat nahi hai.';
    }

    const totalStr = voiceAmountINR(result.totalOutstanding);
    const p1 = result.priorities[0];
    const p2 = result.priorities[1];

    if (p1 && p2) {
      return `${totalStr} pending hai. Aaj ${p1.customerName} se ${voiceAmountINR(p1.amount)} collect karna priority hai because ${p1.reason}. Uske baad ${p2.customerName} se ${voiceAmountINR(p2.amount)}.`;
    } else if (p1) {
      return `${totalStr} pending hai. Aaj ${p1.customerName} se ${voiceAmountINR(p1.amount)} collect karna priority hai because ${p1.reason}.`;
    }

    return `${totalStr} pending hai.`;
  }
}
