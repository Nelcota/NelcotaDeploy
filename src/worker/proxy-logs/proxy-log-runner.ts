import { getDeployment } from "@/deployments";
import { PANEL_PROXY_CONTAINER, PROXY_CONTAINER_NAME } from "@/docker";
import { listProjectDomains } from "@/domains";
import { type Job, requireJobPayloadString } from "@/jobs";
import { proxyCertificateErrors, proxyLogsSince, storeProxyCertificateLogs } from "@/logs";
import { getProject } from "@/projects";
import { getSystemSettings } from "@/settings";

import type { WorkerDependencies } from "../worker.types";

const READ_TIMEOUT_IN_MS = 10_000;
const MAX_CAPTURED_BYTES = 524_288;

/** Reads a bounded snapshot from the managed proxy of the project's live deployment. */
export async function runProxyLogJob(
  dependencies: WorkerDependencies,
  job: Job,
  signal: AbortSignal,
): Promise<void> {
  const { database, config, hosts } = dependencies;
  const project = getProject(database, job.projectId);
  const hostname = requireJobPayloadString(job, "hostname");
  if (job.deploymentId == null || project.currentDeploymentId !== job.deploymentId) {
    throw new Error("The live deployment changed before proxy logs could be read");
  }

  const domains = listProjectDomains(
    database,
    project.id,
    getSystemSettings(database, { includeSecrets: false }),
  );
  if (domains.some((domain) => domain.hostname === hostname && domain.httpsEnabled) === false) {
    throw new Error("The requested HTTPS domain is no longer configured");
  }

  const deployment = getDeployment(database, job.deploymentId);
  const host = hosts.hostOf(database, deployment.serverId);
  if (host.routes == null) {
    throw new Error("The deployment server has no managed proxy");
  }

  const binary = host.platformProxy ? "docker" : config.DOCKER_BINARY;
  const container = host.platformProxy ? PROXY_CONTAINER_NAME : PANEL_PROXY_CONTAINER;
  const since = proxyLogsSince(deployment.startedAt ?? deployment.createdAt, new Date());
  const result = await host.runner(
    [binary, "container", "logs", "--timestamps", "--since", since, "--tail", "500", container],
    {
      signal,
      timeoutInMs: READ_TIMEOUT_IN_MS,
      maxCapturedBytes: MAX_CAPTURED_BYTES,
    },
  );
  if (result.exitCode !== 0 || result.aborted || result.timedOut) {
    throw new Error("Could not read the managed proxy logs");
  }

  storeProxyCertificateLogs(
    database,
    job,
    proxyCertificateErrors(`${result.stdout}\n${result.stderr}`, hostname),
  );
}
