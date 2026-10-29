import { describe, expect, test } from "bun:test";

import { parseDockerSize, parseInspectOutput, parseStatsOutput } from "./docker.output";

describe("parseInspectOutput", () => {
  test("extracts state, health, labels and network addresses", () => {
    const output = JSON.stringify([
      {
        Id: "abc",
        Name: "/nelcota-api-1",
        RestartCount: 2,
        State: {
          Status: "running",
          Running: true,
          StartedAt: "2026-10-28T10:00:00Z",
          Health: { Status: "healthy" },
        },
        Config: { Image: "nelcota/api:1", Labels: { "io.nelcota.managed": "true" } },
        NetworkSettings: { Networks: { nelcota: { IPAddress: "172.20.0.5" } } },
      },
    ]);

    const [info] = parseInspectOutput(output);

    expect(info).toEqual({
      id: "abc",
      name: "nelcota-api-1",
      image: "nelcota/api:1",
      status: "running",
      running: true,
      health: "healthy",
      restartCount: 2,
      startedAt: "2026-10-28T10:00:00Z",
      labels: { "io.nelcota.managed": "true" },
      networkAddresses: { nelcota: "172.20.0.5" },
    });
  });

  test("treats Docker's zero date as never started", () => {
    const output = JSON.stringify([{ Id: "x", State: { StartedAt: "0001-01-01T00:00:00Z" } }]);

    expect(parseInspectOutput(output)[0]?.startedAt).toBeNull();
  });
});

describe("parseDockerSize", () => {
  test.each([
    ["12MiB", 12 * 1024 ** 2],
    ["1.5GiB", 1.5 * 1024 ** 3],
    ["512kB", 512_000],
    ["0B", 0],
  ])("parses %p", (text, bytes) => {
    expect(parseDockerSize(text)).toBe(bytes);
  });

  test.each(["", "--", "12 parsecs"])("returns null for %p instead of guessing", (text) => {
    expect(parseDockerSize(text)).toBeNull();
  });
});

describe("parseStatsOutput", () => {
  test("parses one JSON object per line and keeps unknown values as null", () => {
    const output = [
      JSON.stringify({ Name: "a", CPUPerc: "12.50%", MemUsage: "100MiB / 2GiB" }),
      JSON.stringify({ Name: "b", CPUPerc: "--", MemUsage: "-- / --" }),
    ].join("\n");

    const stats = parseStatsOutput(output);

    expect(stats[0]).toEqual({
      name: "a",
      cpuPercent: 12.5,
      memoryUsedBytes: 100 * 1024 ** 2,
      memoryLimitBytes: 2 * 1024 ** 3,
    });
    expect(stats[1]).toEqual({
      name: "b",
      cpuPercent: null,
      memoryUsedBytes: null,
      memoryLimitBytes: null,
    });
  });
});
