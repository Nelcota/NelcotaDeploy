/** Cumulative CPU jiffies from /proc/stat. */
export type CpuTimes = { readonly idle: number; readonly total: number };

type MemoryUsage = { readonly totalBytes: number; readonly usedBytes: number };
type DiskUsage = { readonly totalBytes: number; readonly usedBytes: number };

const KIBIBYTE = 1024;
const IDLE_FIELD_INDEX = 3;
const IOWAIT_FIELD_INDEX = 4;
const DF_TOTAL_FIELD_INDEX = 1;
const DF_AVAILABLE_FIELD_INDEX = 3;
const PERCENT = 100;

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Parses the aggregate "cpu" line of /proc/stat.
 *
 * @param text - Contents of /proc/stat.
 * @returns Idle and total jiffies, or null when the counters are missing or invalid.
 */
export function parseProcStat(text: string): CpuTimes | null {
  const line = text.split("\n").find((candidate) => candidate.startsWith("cpu "));
  if (line == null) {
    return null;
  }
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  if (
    values.length <= IOWAIT_FIELD_INDEX ||
    values.some((value) => isNonNegativeSafeInteger(value) === false)
  ) {
    return null;
  }
  const idle = (values[IDLE_FIELD_INDEX] ?? 0) + (values[IOWAIT_FIELD_INDEX] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (Number.isSafeInteger(total) === false) {
    return null;
  }

  return { idle, total };
}

/**
 * Computes CPU usage between two /proc/stat readings.
 *
 * @param previous - Earlier reading.
 * @param current - Later reading.
 * @returns Usage between 0 and 100, or null when the counters are invalid or no time elapsed.
 */
export function cpuPercentBetween(previous: CpuTimes, current: CpuTimes): number | null {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (
    isNonNegativeSafeInteger(totalDelta) === false ||
    isNonNegativeSafeInteger(idleDelta) === false ||
    totalDelta === 0
  ) {
    return null;
  }
  const percent = ((totalDelta - idleDelta) / totalDelta) * PERCENT;
  return Math.min(Math.max(percent, 0), PERCENT);
}

function bytesFromBlocks(value: string | undefined): number | null {
  if (value == null || /^\d+$/.test(value) === false) {
    return null;
  }

  const bytes = Number(value) * KIBIBYTE;
  return Number.isSafeInteger(bytes) ? bytes : null;
}

/**
 * Parses /proc/meminfo. Used memory is total minus available, as `free` reports it.
 *
 * @param text - Contents of /proc/meminfo.
 * @returns Memory usage in bytes, or null when fields are missing or invalid.
 */
export function parseMeminfo(text: string): MemoryUsage | null {
  const total = bytesFromBlocks(/^[ \t]*MemTotal:[ \t]+(\d+)[ \t]+kB[ \t]*$/m.exec(text)?.[1]);
  const available = bytesFromBlocks(
    /^[ \t]*MemAvailable:[ \t]+(\d+)[ \t]+kB[ \t]*$/m.exec(text)?.[1],
  );
  if (total == null || available == null || total === 0) {
    return null;
  }
  return { totalBytes: total, usedBytes: Math.max(total - available, 0) };
}

/**
 * Parses the output of `df -Pk <path>`: the last line holds the filesystem's 1024-byte block
 * total and the blocks available to unprivileged users.
 *
 * @param text - Output of df in POSIX format.
 * @returns Disk usage in bytes, or null when the output has no valid data line.
 */
export function parseDiskUsage(text: string): DiskUsage | null {
  const line = text.trim().split("\n").at(-1) ?? "";
  const fields = line.trim().split(/\s+/);
  const totalBytes = bytesFromBlocks(fields[DF_TOTAL_FIELD_INDEX]);
  const availableBytes = bytesFromBlocks(fields[DF_AVAILABLE_FIELD_INDEX]);
  if (totalBytes == null || availableBytes == null || totalBytes === 0) {
    return null;
  }
  return { totalBytes, usedBytes: Math.max(totalBytes - availableBytes, 0) };
}
