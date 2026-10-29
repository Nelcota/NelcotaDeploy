import type { Database } from "@/db";
import {
  cpuPercentBetween,
  type CpuTimes,
  parseDiskUsage,
  parseMeminfo,
  parseProcStat,
  recordHostSample,
} from "@/monitoring";
import type { CommandRunner } from "@/process";

type MemoryReading = ReturnType<typeof parseMeminfo>;
type DiskReading = ReturnType<typeof parseDiskUsage>;
type HostSample = Omit<Parameters<typeof recordHostSample>[1], "serverId">;

const READ_TIMEOUT_IN_MS = 10_000;
// One command reads everything, so a remote server costs a single round trip per sample.
const READ_SCRIPT = 'cat /proc/stat /proc/meminfo; df -Pk -- "$1"';

/**
 * Combines host readings into one sample; a reading that failed becomes null fields.
 *
 * @param cpuPercent - CPU usage since the previous sample, or null on the first one.
 * @param memory - Memory reading, or null when it could not be read.
 * @param disk - Disk reading, or null when it could not be read.
 * @returns The sample to record.
 */
export function toHostSample(
  cpuPercent: number | null,
  memory: MemoryReading,
  disk: DiskReading,
): HostSample {
  return {
    cpuPercent,
    memoryUsedBytes: memory?.usedBytes ?? null,
    memoryTotalBytes: memory?.totalBytes ?? null,
    diskUsedBytes: disk?.usedBytes ?? null,
    diskTotalBytes: disk?.totalBytes ?? null,
  };
}

/** Records CPU, memory and disk usage of one server; CPU usage needs the previous reading. */
export class HostSampler {
  readonly #serverId: string;
  #previousCpu: CpuTimes | null = null;

  constructor(serverId: string) {
    this.#serverId = serverId;
  }

  /**
   * Reads the server once and records the sample.
   *
   * @param database - Database.
   * @param host - The `runner` that reaches the server and the `diskPath` whose filesystem
   *   is measured.
   */
  async sample(
    database: Database,
    host: { readonly runner: CommandRunner; readonly diskPath: string },
  ): Promise<void> {
    const result = await host.runner(["sh", "-c", READ_SCRIPT, "sh", host.diskPath], {
      timeoutInMs: READ_TIMEOUT_IN_MS,
    });
    const cpu = parseProcStat(result.stdout);
    const cpuPercent =
      this.#previousCpu == null || cpu == null ? null : cpuPercentBetween(this.#previousCpu, cpu);
    this.#previousCpu = cpu;
    recordHostSample(database, {
      serverId: this.#serverId,
      ...toHostSample(cpuPercent, parseMeminfo(result.stdout), parseDiskUsage(result.stdout)),
    });
  }
}
