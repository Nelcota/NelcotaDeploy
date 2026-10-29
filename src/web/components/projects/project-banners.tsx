import { AlertTriangleIcon, LoaderCircleIcon, ShieldCheckIcon } from "lucide-react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { useAction } from "@/web/components/layout/use-action";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import { approveProjectFn } from "@/web/functions/projects.functions";

type Project = ProjectDetails["project"];

/** Warnings above a project's tabs: awaiting deploy approval, or the worker being offline. */
export function ProjectBanners({ details }: { readonly details: ProjectDetails }) {
  const { project, worker } = details;
  const workerOffline = worker == null || worker.online === false;
  if (project.deploymentsApproved && workerOffline === false) {
    return null;
  }
  return (
    <div className="space-y-3">
      {project.deploymentsApproved ? null : <ApprovalBanner project={project} />}
      {workerOffline ? <WorkerOfflineBanner /> : null}
    </div>
  );
}

function ApprovalBanner({ project }: { readonly project: Project }) {
  const can = useCan();
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl bg-warning/8 px-5 py-4 ring-1 ring-warning/25 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-2 text-sm">
        <ShieldCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        Este projeto aguarda aprovação de um administrador. O build executa código do repositório,
        por isso nenhum deploy roda antes da aprovação.
      </p>
      {can("project:approve") ? <ApproveButton project={project} /> : null}
    </div>
  );
}

function ApproveButton({ project }: { readonly project: Project }) {
  const approve = useAction({
    action: () => approveProjectFn({ data: { projectId: project.id } }),
    successMessage: "Projeto aprovado para deploy",
    invalidate: [["project", project.id], ["projects"]],
  });
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" disabled={approve.isPending}>
          {approve.isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
          Aprovar
        </Button>
      }
      title="Aprovar deploys deste projeto?"
      description={`O Dockerfile de ${project.repositoryFullName} (branch ${project.branch}) poderá ser executado neste servidor.`}
      confirmLabel="Aprovar"
      onConfirm={() => approve.mutate()}
    />
  );
}

function WorkerOfflineBanner() {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-destructive/8 px-5 py-4 text-sm ring-1 ring-destructive/25"
    >
      <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      O worker, serviço que executa deploys e tasks, está fora do ar. Deploys, ações de contêiner e
      tasks ficam na fila até ele voltar; verifique se o processo está em execução.
    </p>
  );
}
