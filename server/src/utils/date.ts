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
  if (!dateString) return 0;
  let datePart = dateString.split('T')[0];
  if (dateString.includes('T')) {
    const d = new Date(dateString);
    if (!isNaN(d.getTime())) {
      const istTime = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      datePart = istTime.toISOString().split('T')[0];
    }
  }
  const targetDate = new Date(datePart).getTime();
  const today = new Date(getTodayDateString()).getTime();
  const diffMs = Math.max(0, today - targetDate);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

