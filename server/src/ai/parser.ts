import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { ALL_TOOLS } from '../tools/index.js';

export interface ParsedVoiceIntent {
  toolName: string;
  arguments: Record<string, unknown>;
  confidence: number;
  reasoning: string;
}

export class VoiceParser {
  private bedrockClient: BedrockRuntimeClient | null = null;
  private modelId: string;

  constructor() {
    this.modelId = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.bedrockClient = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || 'us-east-1'
      });
    }
  }

  /**
   * Main entrypoint to parse voice input into an MCP tool call.
   * Uses Bedrock Converse API if credentials are present, otherwise falls back to local NLP.
   */
  public async parseUtterance(text: string): Promise<ParsedVoiceIntent> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Empty utterance provided');
    }

    if (this.bedrockClient) {
      try {
        return await this.parseWithBedrock(trimmed);
      } catch (err) {
        console.warn('[VoiceParser] Bedrock inference failed, falling back to local NLP:', err);
      }
    }

    return this.parseLocal(trimmed);
  }

  /**
   * Parses natural language using Amazon Bedrock Converse API with MCP Tool definitions
   */
  private async parseWithBedrock(text: string): Promise<ParsedVoiceIntent> {
    if (!this.bedrockClient) {
      throw new Error('Bedrock client not initialized');
    }

    // Convert MCP tools to Bedrock toolConfig format
    const tools = ALL_TOOLS.map(t => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: {
          json: t.inputSchema
        }
      }
    }));

    const systemPrompt = `You are KhataVoice, an AI assistant for Indian small business owners (kirana merchants, traders).
The user speaks in English, Hindi, or Hinglish to manage their financial ledger.
Based on the merchant's speech, you MUST invoke one of the provided tools (add_entry, get_balance, get_dues, daily_summary).
- 'udhaar' / 'debit' / 'samaan diya' means 'type': 'debit' (merchant gave goods on credit to customer).
- 'jama' / 'credit' / 'diye' / 'chuka diye' means 'type': 'credit' (customer paid back money).
- Customer names can be single words or full names (e.g. Ramesh, Sharma ji).
- Amounts are in Indian Rupees (INR).`;

    const command = new ConverseCommand({
      modelId: this.modelId,
      messages: [
        {
          role: 'user',
          content: [{ text }]
        }
      ],
      system: [{ text: systemPrompt }],
      toolConfig: {
        tools
      }
    });

    const response = await this.bedrockClient.send(command);
    const contentList = response.output?.message?.content || [];

    for (const item of contentList) {
      if (item.toolUse) {
        return {
          toolName: item.toolUse.name || '',
          arguments: (item.toolUse.input as Record<string, unknown>) || {},
          confidence: 0.95,
          reasoning: 'Inferred via Amazon Bedrock Converse API tool-use'
        };
      }
    }

    // If Bedrock didn't invoke a tool, fallback to local
    return this.parseLocal(text);
  }

  /**
   * Robust local rule-based entity and intent parser for Hinglish/English ledger queries.
   * Guarantees 100% offline functionality with zero external credentials.
   */
  public parseLocal(text: string): ParsedVoiceIntent {
    const lower = text.toLowerCase().trim();

    // 0. Collections Copilot Intent Detection (Who to collect from today / priority collections)
    if (
      lower.includes('kin logon se paise') ||
      lower.includes('who should i collect') ||
      lower.includes('who to collect from') ||
      lower.includes('kis customer ko call karu') ||
      lower.includes('pehle kis customer') ||
      lower.includes('sabse pehle kis') ||
      lower.includes('kaun sabse zyada overdue') ||
      lower.includes('sabse zyada overdue') ||
      lower.includes('most overdue') ||
      lower.includes('collection priority') ||
      lower.includes('collection priorities') ||
      lower.includes('collections copilot') ||
      lower.includes('copilot') ||
      lower.includes('kin se paise lene') ||
      lower.includes('kisko call karu') ||
      lower.includes('who owes the most')
    ) {
      return {
        toolName: 'collections_copilot',
        arguments: {},
        confidence: 0.95,
        reasoning: 'Matched Collections Copilot priority intent keywords'
      };
    }

    // 1. Daily Summary detection
    if (
      lower.includes('daily summary') ||
      lower.includes('aaj ka hisaab') ||
      lower.includes('aaj ka summary') ||
      lower.includes('aaj ka total') ||
      lower.includes('day summary') ||
      lower.includes('today summary')
    ) {
      return {
        toolName: 'daily_summary',
        arguments: {},
        confidence: 0.9,
        reasoning: 'Matched daily summary intent keywords'
      };
    }

    // 2. Dues detection (Udhaar list, debtors, who owes money)
    if (
      lower.includes('dues') ||
      lower.includes('kiska udhaar baaki') ||
      lower.includes('kitna lena baaki') ||
      lower.includes('baki list') ||
      lower.includes('debtors') ||
      lower.includes('udhaar list') ||
      lower.includes('pending payment') ||
      lower.includes('sabka udhaar')
    ) {
      let minAmount = 0;
      const minMatch = lower.match(/(?:above|se zyada|greater than)\s+(\d+)/);
      if (minMatch) {
        minAmount = parseInt(minMatch[1], 10);
      }
      return {
        toolName: 'get_dues',
        arguments: { min_amount: minAmount },
        confidence: 0.9,
        reasoning: 'Matched dues list intent keywords'
      };
    }

    // 3. Balance inquiry for specific customer or store
    if (
      lower.includes('balance') ||
      lower.includes('hisaab') ||
      lower.includes('kitna baaki') ||
      lower.includes('kitna bacha') ||
      lower.includes('kitne rupaye baaki')
    ) {
      if (lower.includes('total balance') || lower.includes('dukan ka balance') || lower.includes('store balance')) {
        return {
          toolName: 'get_balance',
          arguments: {},
          confidence: 0.9,
          reasoning: 'Store-wide balance query'
        };
      }

      // Extract customer name
      const cleanTokens = lower
        .replace(/ka hisaab/g, '')
        .replace(/ka balance/g, '')
        .replace(/batao/g, '')
        .replace(/what is the balance of/g, '')
        .replace(/balance of/g, '')
        .replace(/kitna baaki hai/g, '')
        .replace(/par kitna udhaar hai/g, '')
        .trim();

      const customerName = this.extractCustomerName(cleanTokens);
      return {
        toolName: 'get_balance',
        arguments: customerName ? { customer_name: customerName } : {},
        confidence: 0.85,
        reasoning: `Extracted balance query for customer: ${customerName || 'store-wide'}`
      };
    }

    // 4. Add Entry (Credit / Jama OR Debit / Udhaar)
    // Extract numbers/amounts
    const amountMatch = lower.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:rupaye|rs|inr|rupees)?/);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

    const isCredit =
      lower.includes('jama') ||
      lower.includes('credit') ||
      lower.includes('received') ||
      lower.includes('diye') ||
      lower.includes('chuka') ||
      lower.includes('wapas');

    const isDebit =
      lower.includes('udhaar') ||
      lower.includes('debit') ||
      lower.includes('diya') ||
      lower.includes('khate me likho') ||
      lower.includes('gave') ||
      lower.includes('lend') ||
      lower.includes('loan');

    if (amount !== null && (isCredit || isDebit)) {
      const type = isCredit ? 'credit' : 'debit';
      const customerName = this.extractCustomerNameFromTx(lower);

      return {
        toolName: 'add_entry',
        arguments: {
          customer_name: customerName || 'Walk-in Customer',
          amount,
          type,
          description: this.extractDescription(lower)
        },
        confidence: 0.88,
        reasoning: `Parsed ledger entry: ${type} of ₹${amount} for ${customerName || 'Walk-in Customer'}`
      };
    }

    // Fallback: Default to get_balance store-wide
    return {
      toolName: 'get_balance',
      arguments: {},
      confidence: 0.5,
      reasoning: 'Unrecognized utterance, falling back to ledger balance check'
    };
  }

  private extractCustomerNameFromTx(text: string): string {
    // Look for common patterns: "<Name> ko <amount> udhaar", "<Name> ne <amount> jama kiye"
    const match = text.match(/^([a-z\s]+?)\s+(?:ne|ko|se|gave|paid|received)/i);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (!['aaj', 'kal', 'dukan', 'total', 'please'].includes(candidate.toLowerCase())) {
        return this.capitalizeName(candidate);
      }
    }

    // Alternate: "500 udhaar <Name>"
    const matchAlt = text.match(/(?:udhaar|jama|credit|debit)\s+(?:to|from|for)?\s*([a-z\s]+)$/i);
    if (matchAlt && matchAlt[1]) {
      return this.capitalizeName(matchAlt[1].trim());
    }

    return 'Walk-in Customer';
  }

  private extractCustomerName(text: string): string {
    const cleaned = text.replace(/[^a-zA-Z\s]/g, '').trim();
    if (cleaned.length > 0) {
      return this.capitalizeName(cleaned);
    }
    return '';
  }

  private extractDescription(text: string): string {
    const itemMatch = text.match(/(?:for|ka|ki)\s+([a-z0-9\s]+?)(?:udhaar|jama|likho|$)/i);
    if (itemMatch && itemMatch[1]) {
      const desc = itemMatch[1].trim();
      if (desc && !['aaj', '500', 'rupaye'].includes(desc)) {
        return desc;
      }
    }
    return 'Voice transaction';
  }

  private capitalizeName(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
