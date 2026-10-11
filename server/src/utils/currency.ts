/**
 * Formats a number as Indian Currency (e.g. ₹1,25,000 or ₹450)
 */
export function formatINR(amount: number): string {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const formatted = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  }).format(absAmount);
  return `${isNegative ? '-' : ''}₹${formatted}`;
}

/**
 * Creates natural voice-friendly readout string for an amount
 */
export function voiceAmountINR(amount: number): string {
  const absAmount = Math.abs(amount);
  const formatted = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0
  }).format(absAmount);
  return `${formatted} rupaye`;
}
