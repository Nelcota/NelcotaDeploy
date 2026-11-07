import { findHealthProblems, notify, reconcileHealthAlerts } from "@/alerts";
import { databaseEngine, listRunningDatabases } from "@/databases";
import type { Database } from "@/db";
import { databaseContainerNameFor, type DockerEngine } from "@/docker";
import { listLatestHostSamples, listLiveAppContainers } from "@/monitoring";
import { listServers, type Server } from "@/servers";

import type { WorkerDependencies } from "../worker.types";

type HealthDependencies = Pick<WorkerDependencies, "database" | "logger" | "config"> & {
  readonly hosts: {
    readonly hostOf: (
      database: Database,
      serverId: string,
    ) => {
      readonly docker: Pick<DockerEngine, "inspectContainers">;
    };
  };
};

/**
 * Tells, for the running databases of the reachable servers, whether their containers run.
 * Databases on a server the worker cannot reach retain their previous alert state.
 */
async function databaseHealth(dependencies: HealthDependencies, readyServers: readonly Server[]) {
  const { database, hosts, logger } = dependencies;
  const ready = new Set(readyServers.map((server) => server.id));
  const byServer = Map.groupBy(listRunningDatabases(database), (running) => running.serverId);
  const perServer = await Promise.all(
    [...byServer].map(async ([serverId, running]) => {
      const unchecked = {
        databases: [],
        uncheckedKeys: running.map((item) => `database:${item.id}`),
      };
      if (ready.has(serverId) === false) {
        return unchecked;
      }
      try {
        const names = running.map((item) => databaseContainerNameFor(item.id));
        const containers = await hosts.hostOf(database, serverId).docker.inspectContainers(names);
        const runningNames = new Set(
          containers.filter((container) => container.running).map((container) => container.name),
        );
        return {
          uncheckedKeys: [],
          databases: running.map((item) => ({
            databaseId: item.id,
            projectName: item.projectName,
            engineLabel: databaseEngine(item.engine).label,
            containerRunning: runningNames.has(databaseContainerNameFor(item.id)),
          })),
        };
      } catch (error) {
        logger.warn({ err: error, serverId }, "database health check skipped for a server");
        return unchecked;
      }
    }),
  );
  return {
    databases: perServer.flatMap((result) => result.databases),
    uncheckedKeys: perServer.flatMap((result) => result.uncheckedKeys),
  };
}

/**
 * Checks live applications, running databases and server disks, and alerts the admins when a
 * problem starts and when it is resolved. Problems already announced are not repeated.
 *
 * @param dependencies - Database, server hosts, logger and configuration.
 */
export async function checkHealth(dependencies: HealthDependencies): Promise<void> {
  const { database, logger, config } = dependencies;
  const servers = listServers(database);
  const readyServers = servers.filter((server) => server.status === "ready");
  const ready = new Set(readyServers.map((server) => server.id));
  const latest = listLatestHostSamples(database);
  const apps = listLiveAppContainers(database);
  const databases = await databaseHealth(dependencies, readyServers);
  const uncheckedKeys = new Set([
    ...databases.uncheckedKeys,
    ...apps.filter((app) => ready.has(app.serverId) === false).map((app) => `app:${app.projectId}`),
    ...servers
      .filter((server) => {
        const sample = latest.get(server.id);
        return (
          ready.has(server.id) === false ||
          sample?.diskUsedBytes == null ||
          sample.diskTotalBytes == null ||
          sample.diskTotalBytes <= 0
        );
      })
      .map((server) => `disk:${server.id}`),
  ]);
  const problems = findHealthProblems({
    // Snapshots of an unreachable server are stale, and that server already has an alert.
    apps: apps.filter((app) => ready.has(app.serverId)),
    databases: databases.databases,
    disks: readyServers.map((server) => ({
      serverId: server.id,
      serverName: server.name,
      usedBytes: latest.get(server.id)?.diskUsedBytes ?? null,
      totalBytes: latest.get(server.id)?.diskTotalBytes ?? null,
    })),
  });
  const { opened, resolved } = reconcileHealthAlerts(database, problems, {
    now: new Date(),
    uncheckedKeys,
  });
  const link = config.PUBLIC_URL;
  await Promise.all([
    ...opened.map(
      async (problem) =>
        await notify(database, logger, { title: problem.title, text: problem.text, link }),
    ),
    ...resolved.map(
      async (problem) =>
        await notify(database, logger, {
          title: `Resolvido: ${problem.title}`,
          text: problem.text,
          link,
        }),
    ),
  ]);
}
