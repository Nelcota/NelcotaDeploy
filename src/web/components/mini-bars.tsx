import { cn } from "./ui/class-names";

/** Height of an empty or zero bar, so the shape of the chart stays visible. */
const MIN_BAR_PERCENT = 6;
const FULL_BAR_PERCENT = 100;
/** Empty buckets are dimmed so they read as "nothing here" rather than as a small value. */
const EMPTY_BAR_OPACITY = 0.35;
/** Gap between the start of each bar's grow animation, so the chart fills left to right. */
const BAR_STAGGER_IN_MS = 45;

function assertBuckets(windowInMs: number, bucketCount: number): void {
  if (Number.isFinite(windowInMs) === false || windowInMs <= 0) {
    throw new RangeError(`windowInMs must be a positive number, got ${windowInMs}`);
  }
  if (Number.isInteger(bucketCount) === false || bucketCount <= 0) {
    throw new RangeError(`bucketCount must be a positive integer, got ${bucketCount}`);
  }
}

/** Index of the bucket a timestamp falls in, oldest first, or null when outside the window. */
function bucketIndex(
  isoDate: string,
  now: Date,
  windowInMs: number,
  bucketCount: number,
): number | null {
  const time = new Date(isoDate).getTime();
  if (Number.isNaN(time)) {
    return null;
  }
  const ageInMs = now.getTime() - time;
  if (ageInMs < 0 || ageInMs >= windowInMs) {
    return null;
  }
  const bucketSizeInMs = windowInMs / bucketCount;
  return bucketCount - 1 - Math.floor(ageInMs / bucketSizeInMs);
}

/**
 * Counts events per time bucket over a window that ends now.
 *
 * @param isoDates - Event times in ISO 8601; invalid dates and dates outside the window are ignored.
 * @param now - End of the window.
 * @param windowInMs - Length of the window in milliseconds. Must be positive.
 * @param bucketCount - Number of equal buckets. Must be a positive integer.
 * @returns One count per bucket, oldest first.
 * @throws {RangeError} When the window or the bucket count is not positive.
 */
export function bucketCounts(
  isoDates: readonly string[],
  now: Date,
  windowInMs: number,
  bucketCount: number,
): number[] {
  assertBuckets(windowInMs, bucketCount);
  const counts = Array.from({ length: bucketCount }, () => 0);
  for (const isoDate of isoDates) {
    const index = bucketIndex(isoDate, now, windowInMs, bucketCount);
    if (index == null) {
      continue;
    }
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}

/**
 * Averages a series per time bucket over a window that ends now.
 *
 * @param points - Samples; null values and samples outside the window are ignored.
 * @param now - End of the window.
 * @param windowInMs - Length of the window in milliseconds. Must be positive.
 * @param bucketCount - Number of equal buckets. Must be a positive integer.
 * @returns One average per bucket, oldest first; null for a bucket without values.
 * @throws {RangeError} When the window or the bucket count is not positive.
 */
export function bucketAverages(
  points: readonly { readonly createdAt: string; readonly value: number | null }[],
  now: Date,
  windowInMs: number,
  bucketCount: number,
): (number | null)[] {
  assertBuckets(windowInMs, bucketCount);
  const sums = Array.from({ length: bucketCount }, () => ({ total: 0, count: 0 }));
  for (const point of points) {
    if (point.value == null || Number.isFinite(point.value) === false) {
      continue;
    }
    const index = bucketIndex(point.createdAt, now, windowInMs, bucketCount);
    const bucket = index == null ? undefined : sums[index];
    if (bucket == null) {
      continue;
    }
    bucket.total += point.value;
    bucket.count += 1;
  }
  return sums.map((bucket) => (bucket.count === 0 ? null : bucket.total / bucket.count));
}

/**
 * Height of each bar as a percentage of the tallest one; empty and zero buckets keep a
 * small stub so the chart never collapses.
 *
 * @param values - Bucket values; null means no data.
 * @returns One height between 6 and 100 per value.
 */
export function barHeights(values: readonly (number | null)[]): number[] {
  const highest = Math.max(0, ...values.map((value) => value ?? 0));
  return values.map((value) => {
    if (value == null || highest <= 0 || value <= 0) {
      return MIN_BAR_PERCENT;
    }
    return Math.max(MIN_BAR_PERCENT, (value / highest) * FULL_BAR_PERCENT);
  });
}

/**
 * Small decorative bar chart for a stat card. The figure beside it carries the meaning, so
 * the chart is hidden from assistive technology.
 */
export function MiniBars({
  values,
  colorVariable,
  className,
}: {
  readonly values: readonly (number | null)[];
  /** CSS variable of the bar color, such as `--chart-1`. */
  readonly colorVariable: string;
  readonly className?: string;
}) {
  const heights = barHeights(values);
  return (
    <span aria-hidden className={cn("flex h-14 w-32 items-end gap-1", className)}>
      {heights.map((height, index) => (
        <span
          key={index}
          className="flex-1 origin-bottom rounded-t-[4px] transition-[height] duration-700 ease-out motion-safe:animate-bar-grow"
          style={{
            height: `${height}%`,
            animationDelay: `${index * BAR_STAGGER_IN_MS}ms`,
            background: `linear-gradient(to bottom, var(${colorVariable}), color-mix(in oklab, var(${colorVariable}) 55%, transparent))`,
            opacity: values[index] == null || values[index] === 0 ? EMPTY_BAR_OPACITY : 1,
          }}
        />
      ))}
    </span>
  );
}

/**
 * Scales a "filled of total" ratio to a row of at most `maxBlocks` blocks.
 *
 * @param filled - Items to highlight. Must be an integer between 0 and `total`.
 * @param total - All items. Must be a non-negative integer.
 * @param maxBlocks - Most blocks to draw. Must be a positive integer.
 * @returns How many blocks to draw and how many of them to highlight.
 * @throws {RangeError} When a count is negative, not an integer, or `filled` exceeds `total`.
 */
export function blockCounts(
  filled: number,
  total: number,
  maxBlocks: number,
): { readonly filled: number; readonly total: number } {
  if (Number.isInteger(total) === false || total < 0) {
    throw new RangeError(`total must be a non-negative integer, got ${total}`);
  }
  if (Number.isInteger(filled) === false || filled < 0 || filled > total) {
    throw new RangeError(`filled must be an integer between 0 and ${total}, got ${filled}`);
  }
  if (Number.isInteger(maxBlocks) === false || maxBlocks <= 0) {
    throw new RangeError(`maxBlocks must be a positive integer, got ${maxBlocks}`);
  }
  if (total <= maxBlocks) {
    return { filled, total };
  }
  return { filled: Math.round((filled / total) * maxBlocks), total: maxBlocks };
}

const MAX_BLOCKS = 12;

/**
 * Row of blocks, one per item (scaled down past twelve), with the highlighted ones in a
 * color. Decorative: the figure beside it carries the meaning.
 */
export function RatioBlocks({
  filled,
  total,
  colorVariable,
}: {
  readonly filled: number;
  readonly total: number;
  /** CSS variable of the highlighted blocks, such as `--success`. */
  readonly colorVariable: string;
}) {
  const blocks = blockCounts(filled, total, MAX_BLOCKS);
  return (
    <span aria-hidden className="flex h-14 items-end gap-1">
      {Array.from({ length: blocks.total }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-full w-2.5 origin-bottom rounded-[4px] motion-safe:animate-bar-grow",
            index < blocks.filled ? "" : "bg-well-hover",
          )}
          style={{
            animationDelay: `${index * BAR_STAGGER_IN_MS}ms`,
            background: index < blocks.filled ? `var(${colorVariable})` : undefined,
          }}
        />
      ))}
    </span>
  );
}
