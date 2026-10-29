/**
 * Computes a percentage from used and total values.
 *
 * @returns The percentage, or null when either value is missing or the total is not positive.
 */
export function usagePercent(
  used: number | null | undefined,
  total: number | null | undefined,
): number | null {
  if (used == null || total == null || total <= 0) {
    return null;
  }
  const percent = (used / total) * 100;
  return Number.isFinite(percent) ? percent : null;
}
