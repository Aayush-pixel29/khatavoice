import { ILedgerStore } from './interface.js';
import { InMemoryStore } from './memory.js';
import { DynamoDBStore } from './dynamodb.js';

let storeInstance: ILedgerStore | null = null;

export function getLedgerStore(): ILedgerStore {
  if (storeInstance) {
    return storeInstance;
  }

  const driver = process.env.STORAGE_DRIVER || 'memory';
  if (driver.toLowerCase() === 'dynamodb') {
    console.log('[Storage] Initializing DynamoDBStore with table:', process.env.DYNAMODB_TABLE_NAME || 'KhataVoiceTable');
    storeInstance = new DynamoDBStore();
  } else {
    console.log('[Storage] Initializing InMemoryStore (Zero AWS credentials mode)');
    storeInstance = new InMemoryStore();
  }

  return storeInstance;
}

export function setLedgerStore(store: ILedgerStore): void {
  storeInstance = store;
}

export * from './interface.js';
export * from './memory.js';
export * from './dynamodb.js';
