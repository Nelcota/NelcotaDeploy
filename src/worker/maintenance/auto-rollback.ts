import { notify } from "@/alerts";
import {
  listRollbackCandidates,
  listWatchedDeployments,
  recordAutoRollback,
  recordAutoRollbackSkipped,
  requestDeployment,
  type WatchedDeployment,
} from "@/deployments";
import { highestRestartCounts } from "@/monitoring";

import type { WorkerDependencies } from "../worker.types";

/** Restarts of any container within the watch that mean a restart loop. */
const RESTARTS_BEFORE_ROLLBACK = 3;
const MILLISECONDS_PER_MINUTE = 60_000;
const ACTOR = { type: "system", label: "rollback automático" } as const;

type AutoRollbackDependencies = Pick<WorkerDependencies, "database" | "logger" | "config">;

/**
 * Rolls back the live versions that went live within the watch window and whose containers
 * keep restarting, and alerts about each one.
 *
 * @remarks
 * The restart counts are the ones the container observer stores, for every replica of the
 * version. A rollback made here is never watched itself, so a broken older version cannot
 * start a loop of rollbacks; without an earlier version, the alert says so instead.
 *
 * @param dependencies - Database, logger and the watch window.
 * @param now - Current time.
 */
export async function rollBackRestartLoops(
  dependencies: AutoRollbackDependencies,
  now: Date = new Date(),
): Promise<void> {
  const { database, config } = dependencies;
  if (config.AUTO_ROLLBACK_WINDOW_MINUTES === 0) {
    return;
  }
  const since = new Date(
    now.getTime() - config.AUTO_ROLLBACK_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE,
  );
  const watched = listWatchedDeployments(database, since);
  const restarts = highestRestartCounts(
    database,
    watched.map((deployment) => deployment.id),
  );
  const looping = watched.filter(
    (deployment) => (restarts.get(deployment.id) ?? 0) >= RESTARTS_BEFORE_ROLLBACK,
  );
  await Promise.all(
    looping.map(async (deployment) => await rollBack(dependencies, deployment, now)),
  );
}

async function rollBack(
  dependencies: AutoRollbackDependencies,
  deployment: WatchedDeployment,
  now: Date,
): Promise<void> {
  const { database, logger, config } = dependencies;
  const link = `${config.PUBLIC_URL}/projects/${deployment.projectId}/deployments/${deployment.id}`;
  const [previous] = listRollbackCandidates(database, deployment.projectId);
  if (previous == null) {
    recordAutoRollbackSkipped(database, deployment.id, now);
    await notify(database, logger, {
      title: "Versão nova reiniciando",
      text: `${deployment.projectName} reiniciou ${RESTARTS_BEFORE_ROLLBACK} vezes ou mais logo depois do deploy e não há versão anterior para voltar.`,
      link,
    });
    return;
  }
  requestDeployment(database, {
    projectId: deployment.projectId,
    trigger: "auto-rollback",
    actor: ACTOR,
    triggeredByUserId: null,
    sourceDeploymentId: previous.id,
  });
  recordAutoRollback(database, deployment.id, now);
  logger.info({ deploymentId: deployment.id, to: previous.id }, "restart loop rolled back");
  await notify(database, logger, {
    title: "Rollback automático",
    text: `${deployment.projectName} reiniciou ${RESTARTS_BEFORE_ROLLBACK} vezes ou mais logo depois do deploy; o painel voltou para a versão anterior.`,
    link,
  });
}
