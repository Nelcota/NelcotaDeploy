import type { Database } from "@/db";
import {
  cpuPercentBetween,
  type CpuTimes,
  readCpuTimes,
  readDiskUsage,
  readMemoryUsage,
  recordHostSample,
} from "@/monitoring";

type MemoryReading = Awaited<ReturnType<typeof readMemoryUsage>>;
type DiskReading = Awaited<ReturnType<typeof readDiskUsage>>;
type HostSample = Parameters<typeof recordHostSample>[1];

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

/** Records host CPU, memory and disk usage; CPU usage needs the previous reading. */
export class HostSampler {
  #previousCpu: CpuTimes | null = null;

  /**
   * Reads the host once and records the sample.
   *
   * @param database - Database.
   * @param workspaceDir - Directory whose disk is measured.
   */
  async sample(database: Database, workspaceDir: string): Promise<void> {
    const [cpu, memory, disk] = await Promise.all([
      readCpuTimes(),
      readMemoryUsage(),
      readDiskUsage(workspaceDir),
    ]);
    const cpuPercent =
      this.#previousCpu == null || cpu == null ? null : cpuPercentBetween(this.#previousCpu, cpu);
    this.#previousCpu = cpu;
    recordHostSample(database, toHostSample(cpuPercent, memory, disk));
  }
}
