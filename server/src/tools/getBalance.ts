import { z } from 'zod';
import { ILedgerStore } from '../storage/interface.js';

export const getBalanceSchema = z.object({
  merchant_id: z.string().optional().default('default_merchant'),
  customer_name: z.string().optional()
});

export type GetBalanceArgs = z.infer<typeof getBalanceSchema>;

export const getBalanceDefinition = {
  name: 'get_balance',
  description: 'Calculates outstanding balance for a specific customer or returns aggregate balance across the store ledger if customer_name is omitted.',
  inputSchema: {
    type: 'object',
    properties: {
      merchant_id: {
        type: 'string',
        description: "Identifier for the business/store. Defaults to 'default_merchant'."
      },
      customer_name: {
        type: 'string',
        description: 'Optional name of the customer. If omitted, returns overall store-wide receivables and payables.'
      }
    }
  }
};

export async function handleGetBalance(rawArgs: unknown, store: ILedgerStore) {
  const parsed = getBalanceSchema.parse(rawArgs || {});
  const result = await store.getBalance(parsed.merchant_id, parsed.customer_name);

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
