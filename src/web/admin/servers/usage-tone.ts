/** Usage at or above these percentages is shown as a warning or a problem. */
const USAGE_WARNING_PERCENT = 75;
const USAGE_DANGER_PERCENT = 90;

/**
 * Picks the stat tone for a resource usage.
 *
 * @param percent - Usage between 0 and 100, or null when unknown.
 * @returns "danger" from 90%, "warning" from 75%, otherwise "default".
 */
export function usageTone(percent: number | null): "default" | "warning" | "danger" {
  if (percent == null || percent < USAGE_WARNING_PERCENT) {
    return "default";
  }
  return percent >= USAGE_DANGER_PERCENT ? "danger" : "warning";
}

/**
 * Formats a usage percentage for a stat.
 *
 * @param percent - Usage between 0 and 100, or null when unknown.
 * @returns The rounded percentage, or "—" when unknown.
 */
export function formatPercent(percent: number | null): string {
  return percent == null ? "—" : `${Math.round(percent)}%`;
}
