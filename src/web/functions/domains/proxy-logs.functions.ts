import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { getDeployment } from "@/deployments";
import { listProjectDomains, lookupAllWithTimeout } from "@/domains";
import { readProxyCertificateLogs, requestProxyCertificateLogs } from "@/logs";
import { getWorkerStatus } from "@/monitoring";
import { getProject } from "@/projects";
import { LOCAL_SERVER_ID } from "@/servers";
import { getSystemSettings } from "@/settings";
import { domainInputSchema } from "@/shared/schemas/domain.schema";
import { probeHostname } from "@/uptime";
import { authorizeProject } from "@/web/server/authorization";
import { PublicError } from "@/web/server/public-error";

import { idSchema } from "../ids";

const domainTarget = z.object({ projectId: idSchema, hostname: domainInputSchema.shape.hostname });
const MAX_CONCURRENT_HTTPS_CHECKS = 8;
const httpsChecks = new Map<string, ReturnType<typeof startHttpsCheck>>();

async function resolveProxyLogTarget({ projectId, hostname }: z.infer<typeof domainTarget>) {
  await authorizeProject("project:read", projectId);
  const database = getDatabase();
  const project = getProject(database, projectId);
  const domains = listProjectDomains(
    database,
    projectId,
    getSystemSettings(database, { includeSecrets: false }),
  );
  if (
    project.currentDeploymentId == null ||
    domains.some((domain) => domain.hostname === hostname && domain.httpsEnabled) === false
  ) {
    throw new PublicError("Este domínio precisa estar associado a uma versão publicada com HTTPS.");
  }

  const deployment = getDeployment(database, project.currentDeploymentId);
  if (deployment.serverId === LOCAL_SERVER_ID && getConfig().TRAEFIK_ENABLED === false) {
    throw new PublicError("O servidor desta versão não usa um proxy gerenciado pelo painel.");
  }

  return { projectId, hostname, deploymentId: deployment.id };
}

export const requestProxyLogsFn = createServerFn({ method: "POST" })
  .validator(domainTarget)
  .handler(async ({ data }) => {
    const target = await resolveProxyLogTarget(data);
    const database = getDatabase();
    if (getWorkerStatus(database)?.online !== true) {
      throw new PublicError(
        "O worker está desconectado. Consulte os logs novamente quando ele voltar.",
      );
    }

    return requestProxyCertificateLogs(database, target);
  });

export const readProxyLogsFn = createServerFn({ method: "GET" })
  .validator(domainTarget.extend({ requestId: idSchema }))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store");
    const target = await resolveProxyLogTarget(data);
    return readProxyCertificateLogs(getDatabase(), { ...target, requestId: data.requestId });
  });

/** Checks the current address without issuing a certificate or changing its configuration. */
export const verifyDomainHttpsFn = createServerFn({ method: "POST" })
  .validator(domainTarget)
  .handler(async ({ data }) => {
    const { hostname, deploymentId } = await resolveProxyLogTarget(data);
    const running = httpsChecks.get(hostname);
    const { result, checkedAt } = await (running ?? startHttpsCheck(hostname));

    if (result.kind === "private") {
      return { status: "private", checkedAt, deploymentId } as const;
    }

    const status = result.up ? "ready" : (result.reason ?? "connection");
    return { status, checkedAt, deploymentId } as const;
  });

function startHttpsCheck(hostname: string): Promise<{
  readonly result: Awaited<ReturnType<typeof probeHostname>>;
  readonly checkedAt: string;
}> {
  if (httpsChecks.size >= MAX_CONCURRENT_HTTPS_CHECKS) {
    throw new PublicError("Há várias verificações em andamento. Tente novamente em instantes.");
  }

  const check = probeHostname(
    { hostname, httpsEnabled: true },
    { lookup: lookupAllWithTimeout, fetch, now: () => performance.now() },
  )
    .then((result) => ({ result, checkedAt: new Date().toISOString() }))
    .finally(() => httpsChecks.delete(hostname));
  httpsChecks.set(hostname, check);
  return check;
}
