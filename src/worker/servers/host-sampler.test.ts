import { describe, expect, test } from "bun:test";

import { toHostSample } from "./host-sampler";

describe("toHostSample", () => {
  test("copies every reading when all of them succeeded", () => {
    const memory = { usedBytes: 1_000, totalBytes: 4_000 };
    const disk = { usedBytes: 50_000, totalBytes: 200_000 };

    const sample = toHostSample(12.5, memory, disk);

    expect(sample).toEqual({
      cpuPercent: 12.5,
      memoryUsedBytes: 1_000,
      memoryTotalBytes: 4_000,
      diskUsedBytes: 50_000,
      diskTotalBytes: 200_000,
    });
  });

  test("records null fields for readings that failed", () => {
    const sample = toHostSample(null, null, null);

    expect(sample).toEqual({
      cpuPercent: null,
      memoryUsedBytes: null,
      memoryTotalBytes: null,
      diskUsedBytes: null,
      diskTotalBytes: null,
    });
  });
});
