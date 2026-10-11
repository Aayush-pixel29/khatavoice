import { z } from 'zod';
import { ILedgerStore } from '../storage/interface.js';

export const addEntrySchema = z.object({
  merchant_id: z.string().optional().default('default_merchant'),
  customer_name: z.string().min(1, 'customer_name is required'),
  customer_phone: z.string().optional(),
  amount: z.number().positive('amount must be greater than 0'),
  type: z.enum(['credit', 'debit']),
  description: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format').optional(),
  idempotency_key: z.string().optional(),
  client_request_id: z.string().optional()
});

export type AddEntryArgs = z.infer<typeof addEntrySchema>;

export const addEntryDefinition = {
  name: 'add_entry',
  description: 'Records a credit (jama / received money) or debit (udhaar / given goods or credit) transaction for a specific customer in the business ledger.',
  inputSchema: {
    type: 'object',
    properties: {
      merchant_id: {
        type: 'string',
        description: "Identifier for the business/store. Defaults to 'default_merchant'."
      },
      customer_name: {
        type: 'string',
        description: "Name of the customer, vendor, or counterparty (e.g. 'Ramesh', 'Sharma Ji')."
      },
      customer_phone: {
        type: 'string',
        description: 'Optional 10-digit mobile number for WhatsApp payment reminder notifications.'
      },
      amount: {
        type: 'number',
        minimum: 0.01,
        description: 'Transaction amount in rupees (INR).'
      },
      type: {
        type: 'string',
        enum: ['credit', 'debit'],
        description: "'credit' (jama): merchant received money from customer. 'debit' (udhaar): merchant gave goods or credit to customer."
      },
      description: {
        type: 'string',
        description: "Optional memo or item list (e.g. '2 kg ghee, 5 kg atta')."
      },
      date: {
        type: 'string',
        format: 'date',
        description: 'Date in YYYY-MM-DD format. Defaults to current date.'
      },
      idempotency_key: {
        type: 'string',
        description: 'Optional client-provided unique key for at-most-once mutation guarantee (24-hour deduplication window).'
      },
      client_request_id: {
        type: 'string',
        description: 'Alias for idempotency_key.'
      }
    },
    required: ['customer_name', 'amount', 'type']
  }
};

export async function handleAddEntry(rawArgs: unknown, store: ILedgerStore) {
  const parsed = addEntrySchema.parse(rawArgs);
  const idempotencyKey = parsed.idempotency_key || parsed.client_request_id;
  const result = await store.addEntry({
    merchantId: parsed.merchant_id,
    customerName: parsed.customer_name,
    customerPhone: parsed.customer_phone,
    amount: parsed.amount,
    type: parsed.type,
    description: parsed.description,
    date: parsed.date,
    idempotencyKey
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
