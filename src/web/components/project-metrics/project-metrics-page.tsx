import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ContainerIcon } from "lucide-react";
import { useState } from "react";

import { SegmentedControl } from "@/web/components/layout/overview";
import { EmptyState } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";

import { ProjectMetrics } from "./project-metrics";

const WINDOWS = [
  { value: 1, label: "1 hora" },
  { value: 6, label: "6 horas" },
  { value: 24, label: "24 horas" },
] as const;

/** CPU and memory of a project's live container over a chosen period. */
export function ProjectMetricsPage({ projectId }: { readonly projectId: string }) {
  const [hours, setHours] = useState<number>(1);
  const project = useQuery(projectQueryOptions(projectId));
  const neverDeployed = project.data != null && project.data.project.currentDeploymentId == null;

  return (
    <section aria-label="Métricas" className="space-y-6">
      <TabHeader
        title="Métricas"
        actions={
          <SegmentedControl label="Período" options={WINDOWS} value={hours} onChange={setHours} />
        }
      />
      {neverDeployed ? (
        <NoContainerState projectId={projectId} />
      ) : (
        <ProjectMetrics projectId={projectId} hours={hours} />
      )}
    </section>
  );
}

function NoContainerState({ projectId }: { readonly projectId: string }) {
  return (
    <EmptyState
      icon={ContainerIcon}
      title="Nenhum contêiner implantado"
      description="CPU e memória passam a ser coletadas assim que o primeiro deploy colocar a aplicação no ar."
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
