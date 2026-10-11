import { z } from 'zod';
import { ILedgerStore } from '../storage/interface.js';

export const dailySummarySchema = z.object({
  merchant_id: z.string().optional().default('default_merchant'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format').optional()
});

export type DailySummaryArgs = z.infer<typeof dailySummarySchema>;

export const dailySummaryDefinition = {
  name: 'daily_summary',
  description: 'Generates an end-of-day financial reconciliation report showing total cash collected, total credit extended, net cash movement, and transaction counts.',
  inputSchema: {
    type: 'object',
    properties: {
      merchant_id: {
        type: 'string',
        description: "Identifier for the business/store. Defaults to 'default_merchant'."
      },
      date: {
        type: 'string',
        format: 'date',
        description: 'Target date in YYYY-MM-DD format. Defaults to current date if omitted.'
      }
    }
  }
};

export async function handleDailySummary(rawArgs: unknown, store: ILedgerStore) {
  const parsed = dailySummarySchema.parse(rawArgs || {});
  const result = await store.getDailySummary(parsed.merchant_id, parsed.date);

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
