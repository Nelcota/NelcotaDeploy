import { useId } from "react";

import { ApproveButton } from "../project-banners";
import type { ProjectDetails } from "../project-query";
import { CopyProjectLink } from "./copy-project-link";

/** Gives the requester a link to share and explains how the first deploy starts. */
export function PendingProjectApproval({
  project,
  canApprove,
  canDeploy,
}: {
  readonly project: ProjectDetails["project"];
  readonly canApprove: boolean;
  readonly canDeploy: boolean;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="space-y-1">
        <h2 id={headingId} className="text-base font-semibold">
          Aguardando aprovação
        </h2>
        <p className="text-sm text-muted-foreground">
          {canApprove
            ? "Revise o repositório e a branch para aprovar o projeto."
            : "Copie o link e envie a um administrador do painel para pedir a aprovação."}
        </p>
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-start">
        {canApprove ? <ApproveButton project={project} /> : null}
        <CopyProjectLink key={project.id} projectId={project.id} />
      </div>
      <p className="border-t border-border pt-3 text-sm text-muted-foreground">
        {canDeploy
          ? "Depois da aprovação, volte aqui e selecione "
          : "Depois da aprovação, alguém com permissão de deploy pode selecionar "}
        <strong className="font-semibold text-foreground">Publicar primeira versão</strong>.
      </p>
    </section>
  );
}
