/**
 * Returns current date in YYYY-MM-DD format (IST timezone default)
 */
export function getTodayDateString(): string {
  const now = new Date();
  // Adjust to IST (+05:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().split('T')[0];
}

/**
 * Calculates number of days between two YYYY-MM-DD or ISO strings
 */
export function calculateDaysAgo(dateString: string): number {
  const targetDate = new Date(dateString.split('T')[0]).getTime();
  const today = new Date(getTodayDateString()).getTime();
  const diffMs = Math.max(0, today - targetDate);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
