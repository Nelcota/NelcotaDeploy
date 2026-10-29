import { describe, expect, test } from "bun:test";

import { buildMetricStats, isCpuIdle } from "./metric-stats";

const NOW = new Date("2026-10-28T12:00:00Z");

const LATEST_SAMPLE = {
  createdAt: "2026-10-28T11:59:00Z",
  cpuPercent: 10,
  memoryUsedBytes: 1024,
  memoryTotalBytes: 2048,
};

describe("isCpuIdle", () => {
  test("returns false when there are no samples", () => {
    const idle = isCpuIdle([]);

    expect(idle).toBe(false);
  });

  test("returns true when every sample reads zero or nothing", () => {
    const idle = isCpuIdle([{ cpuPercent: 0 }, { cpuPercent: null }]);

    expect(idle).toBe(true);
  });

  test("returns false when any sample used CPU", () => {
    const idle = isCpuIdle([{ cpuPercent: 0 }, { cpuPercent: 0.5 }]);

    expect(idle).toBe(false);
  });
});

describe("buildMetricStats", () => {
  test("shows placeholders when there is no sample and no container", () => {
    const stats = buildMetricStats({ latest: null, container: null, now: NOW });

    expect(stats.map((stat) => stat.detail)).toEqual([
      "sem amostras",
      "limite indisponível",
      undefined,
      undefined,
    ]);
    expect(stats[2]?.value).toBe("—");
  });

  test("warns when the container has restarted", () => {
    const container = { restartCount: 2, startedAt: null };

    const stats = buildMetricStats({ latest: LATEST_SAMPLE, container, now: NOW });

    expect(stats[2]).toMatchObject({ value: 2, tone: "warning" });
  });
});
