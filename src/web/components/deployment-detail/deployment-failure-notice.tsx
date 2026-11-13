import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ScrollTextIcon, SlidersHorizontalIcon, TriangleAlertIcon } from "lucide-react";

import { deploymentFailureStage } from "@/web/components/deployments/deployment-stages";
import {
  projectSettingsDestination,
  SETTINGS_HEADING_ID,
} from "@/web/components/project-settings/navigation/settings-destinations";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";
import { getDeploymentFn } from "@/web/functions/deployments.functions";

import {
  currentDeploymentOf,
  deploymentFailureAvailability,
  deploymentFailureGuidance,
} from "./deployment-failure-state";
import type { DeploymentDetailData } from "./use-deployment-detail";

function TechnicalError({ message }: { readonly message: string }) {
  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="solar-[alt-arrow-down-linear] size-4 shrink-0" />
        Detalhes do erro
      </summary>
      <pre className="border-t border-border px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
        {message}
      </pre>
    </details>
  );
}

function FailedStage({ deployment }: { readonly deployment: DeploymentDetailData }) {
  const stage = deploymentFailureStage(deployment);
  return (
    <p className="text-sm">
      {stage == null ? (
        "Etapa não identificada."
      ) : (
        <>
          {deployment.failureStage == null ? "Etapa provável" : "Etapa que falhou"}:{" "}
          <strong>{stage}</strong>
        </>
      )}
    </p>
  );
}

/** Puts the failed stage, current availability and a direct link to logs before the timeline. */
export function DeploymentFailureNotice({
  deployment,
  details,
}: {
  readonly deployment: DeploymentDetailData;
  readonly details: ProjectDetails | undefined;
}) {
  const currentId = currentDeploymentOf(deployment, details) ?? null;
  const current = useQuery({
    queryKey: ["deployment", currentId],
    queryFn: () => getDeploymentFn({ data: { deploymentId: currentId ?? "" } }),
    enabled: currentId != null && currentId !== deployment.id,
  });
  const guidance = deploymentFailureGuidance(deployment.failureCause);
  const availability = deploymentFailureAvailability(
    deployment,
    details,
    current.data?.createdAt ?? null,
  );
  const errorMessage = deployment.errorMessage?.trim();

  return (
    <div className="space-y-3 rounded-xl border border-destructive/25 bg-destructive/8 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold text-destructive">Falha no deploy</h2>
          <FailedStage deployment={deployment} />
          <p className="text-sm text-muted-foreground">{availability}</p>
        </div>
      </div>
      <FailureLinks
        deployment={deployment}
        permissions={details?.permissions ?? []}
        guidance={guidance}
      />
      {guidance == null ? null : <p className="text-sm">{guidance.text}</p>}
      {errorMessage == null || errorMessage === "" ? null : (
        <TechnicalError message={errorMessage} />
      )}
    </div>
  );
}

function FailureLinks({
  deployment,
  permissions,
  guidance,
}: {
  readonly deployment: DeploymentDetailData;
  readonly permissions: ProjectDetails["permissions"];
  readonly guidance: ReturnType<typeof deploymentFailureGuidance>;
}) {
  const destination =
    guidance?.section == null ? undefined : projectSettingsDestination(guidance.section);
  const allowed =
    destination != null &&
    ("permission" in destination === false || permissions.includes(destination.permission));

  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap">
      <Button asChild className="min-h-11">
        <Link
          to="/projects/$projectId/deployments/$deploymentId/logs"
          params={{ projectId: deployment.projectId, deploymentId: deployment.id }}
        >
          <ScrollTextIcon aria-hidden />
          Abrir logs do deploy
        </Link>
      </Button>
      {allowed && guidance != null && "action" in guidance ? (
        <Button asChild variant="outline" className="min-h-11">
          <Link
            to={destination.to}
            params={{ projectId: deployment.projectId }}
            hash={SETTINGS_HEADING_ID}
          >
            <SlidersHorizontalIcon aria-hidden />
            {guidance.action}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
