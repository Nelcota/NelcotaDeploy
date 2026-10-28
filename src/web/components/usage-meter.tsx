import { formatPercent } from "@/shared/format";

import { cn } from "./ui/class-names";

const WARNING_PERCENT = 75;
const DANGER_PERCENT = 90;

/** Labeled progress bar. Shows "Indisponível" instead of a number when the value is unknown. */
export function UsageMeter({
  label,
  percent,
  detail,
}: {
  readonly label: string;
  readonly percent: number | null;
  readonly detail?: string | undefined;
}) {
  const known = percent != null && Number.isFinite(percent);
  const clamped = known ? Math.min(Math.max(percent, 0), 100) : 0;
  let barClass = "bg-success";
  if (clamped >= DANGER_PERCENT) {
    barClass = "bg-destructive";
  } else if (clamped >= WARNING_PERCENT) {
    barClass = "bg-warning";
  }
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="font-semibold text-foreground tabular-nums">
          {known ? formatPercent(clamped) : "Indisponível"}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? Math.round(clamped) : undefined}
        aria-valuetext={known ? formatPercent(clamped) : "Indisponível"}
        className="h-2.5 overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className={cn("h-full rounded-full transition-all", barClass)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {detail == null ? null : <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

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
