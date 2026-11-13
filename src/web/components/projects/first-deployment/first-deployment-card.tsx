import { Link } from "@tanstack/react-router";
import { LoaderCircleIcon, RocketIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";

import type { ProjectDetails } from "../project-query";
import { useProjectActions } from "../use-project-actions";
import { firstDeploymentState } from "./first-deployment-state";
import { PendingProjectApproval } from "./pending-project-approval";

type Project = ProjectDetails["project"];

/** Shows the next step above the tabs until a version has been published. */
export function FirstDeploymentCard({ details }: { readonly details: ProjectDetails }) {
  const can = useCan();
  const { project, activeDeployment } = details;
  const canDeploy = can("deployment:create");
  const state = firstDeploymentState({
    hasLiveDeployment: project.currentDeploymentId != null,
    hasActiveDeployment: activeDeployment != null,
    approved: project.deploymentsApproved,
    canDeploy,
  });

  switch (state) {
    case "live":
      return null;
    case "in-progress":
      return activeDeployment == null ? null : (
        <ActiveDeploymentStep projectId={project.id} deploymentId={activeDeployment.id} />
      );
    case "awaiting-approval":
      return (
        <PendingProjectApproval
          project={project}
          canApprove={can("project:approve")}
          canDeploy={canDeploy}
        />
      );
    case "read-only":
      return (
        <NextStep
          title="Primeira publicação pendente"
          description="Uma pessoa com permissão de deploy pode publicar a primeira versão."
        />
      );
    case "ready":
      return (
        <NextStep
          title="Próximo passo: publicar"
          description={`O primeiro deploy usa a branch ${project.branch} e as configurações salvas do projeto.`}
        >
          <FirstDeploymentButton project={project} />
        </NextStep>
      );
  }
}

function ActiveDeploymentStep({
  projectId,
  deploymentId,
}: {
  readonly projectId: string;
  readonly deploymentId: string;
}) {
  return (
    <NextStep
      title="Primeira publicação em andamento"
      description="Acompanhe a fila e as etapas do deploy."
    >
      <Button asChild variant="outline" className="min-h-11">
        <Link
          to="/projects/$projectId/deployments/$deploymentId"
          params={{ projectId, deploymentId }}
        >
          Acompanhar deploy
        </Link>
      </Button>
    </NextStep>
  );
}

function NextStep({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{description}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

function FirstDeploymentButton({ project }: { readonly project: Project }) {
  const { deploy } = useProjectActions(project.id);
  return (
    <ConfirmDialog
      trigger={
        <Button className="min-h-11" disabled={deploy.isPending}>
          {deploy.isPending ? (
            <LoaderCircleIcon aria-hidden className="animate-spin" />
          ) : (
            <RocketIcon aria-hidden />
          )}
          Publicar primeira versão
        </Button>
      }
      title="Iniciar o primeiro deploy?"
      description={`O painel vai construir e executar ${project.repositoryFullName}, na branch ${project.branch}, usando as configurações salvas.`}
      confirmLabel="Confirmar publicação"
      onConfirm={() => deploy.mutate()}
    />
  );
}
