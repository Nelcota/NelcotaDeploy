import { inArray } from "drizzle-orm";

import { type Database, tables } from "@/db";

/** Restarts of a live container that count as a restart loop. */
const RESTART_LOOP_THRESHOLD = 3;
/** Share of a server's disk in use from which it is reported, between 0 and 1. */
const DISK_USAGE_THRESHOLD = 0.85;
const PERCENT = 100;

/** The live container of a deployed project, or null when it is gone. */
type AppHealth = {
  readonly projectId: string;
  readonly projectName: string;
  readonly container: { readonly state: string; readonly restartCount: number } | null;
};

/** A database the platform considers running, and whether its container runs. */
type DatabaseHealth = {
  readonly databaseId: string;
  readonly projectName: string;
  readonly engineLabel: string;
  readonly containerRunning: boolean;
};

/** The newest disk sample of a server. */
type DiskHealth = {
  readonly serverId: string;
  readonly serverName: string;
  readonly usedBytes: number | null;
  readonly totalBytes: number | null;
};

/** A problem an admin should hear about, identified by a stable key. */
type HealthProblem = {
  readonly key: string;
  readonly title: string;
  readonly text: string;
};

function appProblem(app: AppHealth): HealthProblem | null {
  const key = `app:${app.projectId}`;
  if (app.container?.state !== "running") {
    return {
      key,
      title: "Aplicação fora do ar",
      text: `O contêiner de ${app.projectName} não está rodando.`,
    };
  }
  if (app.container.restartCount >= RESTART_LOOP_THRESHOLD) {
    return {
      key,
      title: "Aplicação reiniciando",
      text: `O contêiner de ${app.projectName} já reiniciou ${app.container.restartCount} vezes. Veja os logs.`,
    };
  }
  return null;
}

function diskProblem(disk: DiskHealth): HealthProblem | null {
  if (disk.usedBytes == null || disk.totalBytes == null || disk.totalBytes <= 0) {
    return null;
  }
  const usage = disk.usedBytes / disk.totalBytes;
  if (Number.isFinite(usage) === false || usage < DISK_USAGE_THRESHOLD) {
    return null;
  }
  return {
    key: `disk:${disk.serverId}`,
    title: "Disco quase cheio",
    text: `O disco de ${disk.serverName} está ${Math.round(usage * PERCENT)}% ocupado.`,
  };
}

/**
 * Finds what is wrong with live applications, running databases and server disks.
 *
 * @param input - Live `apps`, running `databases` and the newest `disks` samples.
 * @returns One problem per affected application, database or server.
 */
export function findHealthProblems(input: {
  readonly apps: readonly AppHealth[];
  readonly databases: readonly DatabaseHealth[];
  readonly disks: readonly DiskHealth[];
}): HealthProblem[] {
  const databaseProblems = input.databases
    .filter((database) => database.containerRunning === false)
    .map((database) => ({
      key: `database:${database.databaseId}`,
      title: "Banco de dados parado",
      text: `O ${database.engineLabel} de ${database.projectName} não está rodando.`,
    }));
  return [
    ...input.apps.map(appProblem).filter((problem) => problem != null),
    ...databaseProblems,
    ...input.disks.map(diskProblem).filter((problem) => problem != null),
  ];
}

/**
 * Records the current problems and tells which ones started and which ones ended since the
 * previous check.
 *
 * @param database - Database.
 * @param problems - Problems found now.
 * @param now - Current time.
 * @returns The `opened` problems and the `resolved` ones, as they were announced.
 */
export function reconcileHealthAlerts(
  database: Database,
  problems: readonly HealthProblem[],
  now: Date,
): { readonly opened: HealthProblem[]; readonly resolved: HealthProblem[] } {
  return database.transaction((transaction) => {
    const known = transaction
      .select({
        key: tables.healthAlerts.key,
        title: tables.healthAlerts.title,
        text: tables.healthAlerts.text,
      })
      .from(tables.healthAlerts)
      .all();
    const knownKeys = new Set(known.map((alert) => alert.key));
    const currentKeys = new Set(problems.map((problem) => problem.key));
    const opened = problems.filter((problem) => knownKeys.has(problem.key) === false);
    const resolved = known.filter((alert) => currentKeys.has(alert.key) === false);
    if (opened.length > 0) {
      transaction
        .insert(tables.healthAlerts)
        .values(
          opened.map((problem) => ({
            key: problem.key,
            title: problem.title,
            text: problem.text,
            openedAt: now.toISOString(),
          })),
        )
        .run();
    }
    if (resolved.length > 0) {
      transaction
        .delete(tables.healthAlerts)
        .where(
          inArray(
            tables.healthAlerts.key,
            resolved.map((alert) => alert.key),
          ),
        )
        .run();
    }
    return { opened, resolved };
  });
}
