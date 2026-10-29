import { Link } from "@tanstack/react-router";
import { ContainerIcon } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";
import { Skeleton } from "@/web/components/ui/skeleton";

import { SourceDescription } from "./source-description";

/** Height shared by the console and its loading placeholder, so nothing jumps on load. */
export const CONSOLE_HEIGHT_CLASS = "h-[min(72dvh,46rem)]";

export function RuntimeLogsSection({ children }: { readonly children: ReactNode }) {
  return (
    <section aria-label="Logs de execução" className="space-y-6">
      {children}
    </section>
  );
}

export function RuntimeLogsHeader({
  details,
  selected,
  now,
}: {
  readonly details: ProjectDetails | undefined;
  readonly selected: string;
  readonly now: Date;
}) {
  const hasLiveDeploy = details?.project.currentDeploymentId != null;
  return (
    <TabHeader
      title="Logs"
      description={
        details == null || hasLiveDeploy === false ? (
          "Saída do contêiner em tempo real. Valores de secrets são ocultados."
        ) : (
          <SourceDescription details={details} selected={selected} now={now} />
        )
      }
    />
  );
}

export function ConsoleSkeleton() {
  return <Skeleton className={`${CONSOLE_HEIGHT_CLASS} rounded-xl`} />;
}

export function NoContainerState({ projectId }: { readonly projectId: string }) {
  return (
    <EmptyState
      icon={ContainerIcon}
      title="Nenhum contêiner implantado"
      description="Os logs aparecem aqui assim que o primeiro deploy colocar a aplicação no ar."
      action={
        <Button variant="outline" asChild>
          <Link to="/projects/$projectId/deployments" params={{ projectId }}>
            Ver deploys
          </Link>
        </Button>
      }
    />
  );
}
