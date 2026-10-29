import { ClockIcon, ContainerIcon, RotateCwIcon } from "lucide-react";

import { formatDateTime, formatRelativeTime, pluralize } from "@/shared/format";
import { currentContainer } from "@/web/components/projects/project-header";
import type { ProjectDetails } from "@/web/components/projects/project-query";

import { ALL_DEPLOYMENTS } from "./runtime-logs";

/** One line under the title saying where the lines come from. */
export function SourceDescription({
  details,
  selected,
  now,
}: {
  readonly details: ProjectDetails;
  readonly selected: string;
  readonly now: Date;
}) {
  if (selected === ALL_DEPLOYMENTS) {
    return "Linhas de todos os deploys recentes, do mais antigo ao mais novo.";
  }
  if (selected !== details.project.currentDeploymentId) {
    return "Logs de um deploy anterior; o contêiner dele pode já ter sido removido.";
  }
  const container = currentContainer(details);
  if (container == null) {
    return "Saída do contêiner em tempo real. O worker ainda não informou o contêiner do deploy.";
  }
  const restarts = container.restartCount;
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <ContainerIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate font-mono text-xs" title={container.image}>
          {container.name}
        </span>
      </span>
      {container.state === "running" && container.startedAt != null ? (
        <span className="inline-flex items-center gap-1.5">
          <ClockIcon aria-hidden className="size-3.5 shrink-0" />
          <time dateTime={container.startedAt} title={formatDateTime(container.startedAt)}>
            iniciado {formatRelativeTime(container.startedAt, now)}
          </time>
        </span>
      ) : null}
      <span
        className={
          restarts > 0
            ? "inline-flex items-center gap-1.5 text-warning"
            : "inline-flex items-center gap-1.5"
        }
      >
        <RotateCwIcon aria-hidden className="size-3.5 shrink-0" />
        {pluralize(restarts, "reinício", "reinícios")}
      </span>
    </span>
  );
}
