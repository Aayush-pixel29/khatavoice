import { describe, it, expect } from 'vitest';
import { VoiceParser } from '../src/ai/parser.js';

describe('VoiceParser Local Intent Recognition', () => {
  const parser = new VoiceParser();

  it('parses debit (udhaar) transaction', () => {
    const intent = parser.parseLocal('Ramesh ko 500 rupaye udhaar');
    expect(intent.toolName).toBe('add_entry');
    expect(intent.arguments.customer_name).toBe('Ramesh');
    expect(intent.arguments.amount).toBe(500);
    expect(intent.arguments.type).toBe('debit');
  });

  it('parses credit (jama) transaction', () => {
    const intent = parser.parseLocal('Ramesh ne 250 jama kiye');
    expect(intent.toolName).toBe('add_entry');
    expect(intent.arguments.customer_name).toBe('Ramesh');
    expect(intent.arguments.amount).toBe(250);
    expect(intent.arguments.type).toBe('credit');
  });

  it('parses balance inquiry for a customer', () => {
    const intent = parser.parseLocal('Suresh ka balance batao');
    expect(intent.toolName).toBe('get_balance');
    expect(intent.arguments.customer_name).toBe('Suresh');
  });

  it('parses dues inquiry', () => {
    const intent = parser.parseLocal('Kitna lena baaki hai?');
    expect(intent.toolName).toBe('get_dues');
  });

  it('parses daily summary inquiry', () => {
    const intent = parser.parseLocal('Aaj ka hisaab batao');
    expect(intent.toolName).toBe('daily_summary');
  });
});
