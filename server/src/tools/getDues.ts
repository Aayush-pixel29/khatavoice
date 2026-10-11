import { z } from 'zod';
import { ILedgerStore } from '../storage/interface.js';

export const getDuesSchema = z.object({
  merchant_id: z.string().optional().default('default_merchant'),
  min_amount: z.number().min(0).optional().default(0),
  limit: z.number().int().positive().max(50).optional().default(10)
});

export type GetDuesArgs = z.infer<typeof getDuesSchema>;

export const getDuesDefinition = {
  name: 'get_dues',
  description: 'Lists all customers who have outstanding pending debt (udhaar) to collect, sorted by highest amount owed, with optional threshold filtering.',
  inputSchema: {
    type: 'object',
    properties: {
      merchant_id: {
        type: 'string',
        description: "Identifier for the business/store. Defaults to 'default_merchant'."
      },
      min_amount: {
        type: 'number',
        minimum: 0,
        description: 'Optional minimum debt threshold filter (e.g. only show customers who owe more than ₹500).'
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Maximum number of debtor records to return. Defaults to 10.'
      }
    }
  }
};

export async function handleGetDues(rawArgs: unknown, store: ILedgerStore) {
  const parsed = getDuesSchema.parse(rawArgs || {});
  const result = await store.getDues(parsed.merchant_id, {
    minAmount: parsed.min_amount,
    limit: parsed.limit
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }
    ],
    isError: false
  };
}
