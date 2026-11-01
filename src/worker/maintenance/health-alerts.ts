import { findHealthProblems, notify, reconcileHealthAlerts } from "@/alerts";
import { databaseEngine, listRunningDatabases } from "@/databases";
import { databaseContainerNameFor } from "@/docker";
import { listLatestHostSamples, listLiveAppContainers } from "@/monitoring";
import { listServers, type Server } from "@/servers";

import type { WorkerDependencies } from "../worker.types";

type HealthDependencies = Pick<WorkerDependencies, "database" | "hosts" | "logger" | "config">;

/**
 * Tells, for the running databases of the reachable servers, whether their containers run.
 * Databases on a server the worker cannot reach are left out: that server has its own alert.
 */
async function databaseHealth(dependencies: HealthDependencies, readyServers: readonly Server[]) {
  const { database, hosts, logger } = dependencies;
  const ready = new Set(readyServers.map((server) => server.id));
  const byServer = Map.groupBy(
    listRunningDatabases(database).filter((running) => ready.has(running.serverId)),
    (running) => running.serverId,
  );
  const perServer = await Promise.all(
    [...byServer].map(async ([serverId, running]) => {
      try {
        const names = running.map((item) => databaseContainerNameFor(item.id));
        const containers = await hosts.hostOf(database, serverId).docker.inspectContainers(names);
        const runningNames = new Set(
          containers.filter((container) => container.running).map((container) => container.name),
        );
        return running.map((item) => ({
          databaseId: item.id,
          projectName: item.projectName,
          engineLabel: databaseEngine(item.engine).label,
          containerRunning: runningNames.has(databaseContainerNameFor(item.id)),
        }));
      } catch (error) {
        logger.warn({ err: error, serverId }, "database health check skipped for a server");
        return [];
      }
    }),
  );
  return perServer.flat();
}

/**
 * Checks live applications, running databases and server disks, and alerts the admins when a
 * problem starts and when it is resolved. Problems already announced are not repeated.
 *
 * @param dependencies - Database, server hosts, logger and configuration.
 */
export async function checkHealth(dependencies: HealthDependencies): Promise<void> {
  const { database, logger, config } = dependencies;
  const readyServers = listServers(database).filter((server) => server.status === "ready");
  const ready = new Set(readyServers.map((server) => server.id));
  const latest = listLatestHostSamples(database);
  const problems = findHealthProblems({
    // Snapshots of an unreachable server are stale, and that server already has an alert.
    apps: listLiveAppContainers(database).filter((app) => ready.has(app.serverId)),
    databases: await databaseHealth(dependencies, readyServers),
    disks: readyServers.map((server) => ({
      serverId: server.id,
      serverName: server.name,
      usedBytes: latest.get(server.id)?.diskUsedBytes ?? null,
      totalBytes: latest.get(server.id)?.diskTotalBytes ?? null,
    })),
  });
  const { opened, resolved } = reconcileHealthAlerts(database, problems, new Date());
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
