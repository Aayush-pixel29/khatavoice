import { ILedgerStore } from '../storage/interface.js';
import { addEntryDefinition, handleAddEntry } from './addEntry.js';
import { getBalanceDefinition, handleGetBalance } from './getBalance.js';
import { getDuesDefinition, handleGetDues } from './getDues.js';
import { dailySummaryDefinition, handleDailySummary } from './dailySummary.js';

export const ALL_TOOLS = [
  addEntryDefinition,
  getBalanceDefinition,
  getDuesDefinition,
  dailySummaryDefinition
];

export async function executeTool(name: string, args: unknown, store: ILedgerStore) {
  switch (name) {
    case 'add_entry':
      return await handleAddEntry(args, store);
    case 'get_balance':
      return await handleGetBalance(args, store);
    case 'get_dues':
      return await handleGetDues(args, store);
    case 'daily_summary':
      return await handleDailySummary(args, store);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export * from './addEntry.js';
export * from './getBalance.js';
export * from './getDues.js';
export * from './dailySummary.js';
