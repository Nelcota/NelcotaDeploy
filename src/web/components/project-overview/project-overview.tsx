import { useQuery } from "@tanstack/react-query";

import { ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";

import { ContainerCard } from "./fact-cards";

/** The current production state; histories, previews, metrics and settings have their own pages. */
export function ProjectOverview({ projectId }: { readonly projectId: string }) {
  const details = useQuery(projectQueryOptions(projectId));

  if (details.data == null) {
    return <ListSkeleton rows={4} />;
  }
  const data = details.data;
  return (
    <div className="space-y-6">
      {data.project.currentDeploymentId == null ? null : (
        <TabHeader title="Detalhes da aplicação" />
      )}
      {data.project.currentDeploymentId == null ? null : <ContainerCard details={data} />}
    </div>
  );
}
