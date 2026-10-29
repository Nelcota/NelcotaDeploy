import { z } from "zod";

const BYTES_IN_KIB = 1024;
const BYTES_IN_MIB = BYTES_IN_KIB * BYTES_IN_KIB;
const BYTES_IN_GIB = BYTES_IN_MIB * BYTES_IN_KIB;
const BYTES_IN_TIB = BYTES_IN_GIB * BYTES_IN_KIB;
const BYTES_PER_UNIT: Record<string, number> = {
  B: 1,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  KIB: BYTES_IN_KIB,
  MIB: BYTES_IN_MIB,
  GIB: BYTES_IN_GIB,
  TIB: BYTES_IN_TIB,
};

/** State of a container as reported by `docker inspect`. */
export type ContainerInfo = {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly status: string;
  readonly running: boolean;
  readonly health: string | null;
  readonly restartCount: number;
  readonly startedAt: string | null;
  readonly labels: Readonly<Record<string, string>>;
  /** IP address per attached network. */
  readonly networkAddresses: Readonly<Record<string, string>>;
};

/** Resource usage of one container from `docker stats`. */
export type ContainerStats = {
  readonly name: string;
  readonly cpuPercent: number | null;
  readonly memoryUsedBytes: number | null;
  readonly memoryLimitBytes: number | null;
};

const ZERO_DATE_PREFIX = "0001-01-01";

// Docker's JSON is trusted but loosely shaped: missing or odd fields fall back to empty values
// instead of failing the whole read.
const text = z.string().optional().catch(undefined);

const inspectSchema = z.array(
  z.object({
    Id: text,
    Name: text,
    RestartCount: z.number().optional().catch(undefined),
    State: z
      .object({
        Status: text,
        Running: z.boolean().optional().catch(undefined),
        StartedAt: text,
        Health: z.object({ Status: text }).nullish().catch(undefined),
      })
      .optional()
      .catch(undefined),
    Config: z
      .object({
        Image: text,
        Labels: z.record(z.string(), z.unknown()).nullish().catch(undefined),
      })
      .optional()
      .catch(undefined),
    NetworkSettings: z
      .object({
        Networks: z
          .record(z.string(), z.object({ IPAddress: text }))
          .nullish()
          .catch(undefined),
      })
      .optional()
      .catch(undefined),
  }),
);

const statsLineSchema = z.object({ Name: text, CPUPerc: text, MemUsage: text });

function nonEmpty(value: string | undefined): string | null {
  return value == null || value === "" ? null : value;
}

type InspectedContainer = z.infer<typeof inspectSchema>[number];

function readStartedAt(container: InspectedContainer): string | null {
  const startedAt = nonEmpty(container.State?.StartedAt);
  // Docker reports never-started containers with a zero date instead of an empty value.
  if (startedAt == null || startedAt.startsWith(ZERO_DATE_PREFIX)) {
    return null;
  }
  return startedAt;
}

function readLabels(container: InspectedContainer): Record<string, string> {
  const labels = Object.entries(container.Config?.Labels ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(labels);
}

function readNetworkAddresses(container: InspectedContainer): Record<string, string> {
  const networkAddresses = Object.entries(container.NetworkSettings?.Networks ?? {}).flatMap(
    ([name, network]) => {
      const address = nonEmpty(network.IPAddress);
      return address == null ? [] : [[name, address] as const];
    },
  );
  return Object.fromEntries(networkAddresses);
}

function readState(
  container: InspectedContainer,
): Pick<ContainerInfo, "status" | "running" | "health"> {
  return {
    status: nonEmpty(container.State?.Status) ?? "unknown",
    running: container.State?.Running === true,
    health: nonEmpty(container.State?.Health?.Status),
  };
}

function toContainerInfo(container: InspectedContainer): ContainerInfo {
  return {
    id: container.Id ?? "",
    name: (container.Name ?? "").replace(/^\//, ""),
    image: container.Config?.Image ?? "",
    ...readState(container),
    restartCount: container.RestartCount ?? 0,
    startedAt: readStartedAt(container),
    labels: readLabels(container),
    networkAddresses: readNetworkAddresses(container),
  };
}

/**
 * Parses the JSON array printed by `docker container inspect`.
 *
 * @param output - Raw stdout.
 * @returns Parsed container information; nothing when the output is not a list.
 */
export function parseInspectOutput(output: string): ContainerInfo[] {
  const parsed = inspectSchema.safeParse(JSON.parse(output));
  if (parsed.success === false) {
    return [];
  }
  return parsed.data.map((container) => toContainerInfo(container));
}

/**
 * Parses a docker size such as "12.5MiB" into bytes.
 *
 * @param text - Size with unit.
 * @returns Bytes, or null when the text is not a size.
 */
export function parseDockerSize(text: string): number | null {
  const match = /^([\d.]+)\s*([A-Za-z]+)$/.exec(text.trim());
  const amount = Number(match?.[1]);
  const multiplier = BYTES_PER_UNIT[(match?.[2] ?? "").toUpperCase()];
  if (multiplier == null || Number.isFinite(amount) === false) {
    return null;
  }
  return Math.round(amount * multiplier);
}

/**
 * Parses `docker stats --format '{{json .}}'` output, one JSON object per line.
 *
 * @param output - Raw stdout.
 * @returns Parsed stats; unparseable values are null, never guessed.
 */
export function parseStatsOutput(output: string): ContainerStats[] {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const row = statsLineSchema.parse(JSON.parse(line));
      const cpuPercent = Number.parseFloat((row.CPUPerc ?? "").replace("%", ""));
      const [usedText = "", limitText = ""] = (row.MemUsage ?? "").split("/");
      return {
        name: row.Name ?? "",
        cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : null,
        memoryUsedBytes: parseDockerSize(usedText),
        memoryLimitBytes: parseDockerSize(limitText),
      };
    });
}
