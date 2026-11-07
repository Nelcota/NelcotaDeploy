import { useQuery } from "@tanstack/react-query";

import { ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";

import { ContainerCard } from "./fact-cards";
import { SituationCard } from "./situation/situation-card";
import { useRecentDeployments } from "./use-recent-deployments";

/** The current production state; histories, previews, metrics and settings have their own pages. */
export function ProjectOverview({ projectId }: { readonly projectId: string }) {
  const details = useQuery(projectQueryOptions(projectId));
  const recent = useRecentDeployments(projectId);

  if (details.data == null) {
    return <ListSkeleton rows={4} />;
  }
  const data = details.data;
  return (
    <div className="space-y-6">
      <TabHeader title="Status da aplicação" />
      <SituationCard
        details={data}
        latest={recent.data?.[0] ?? null}
        latestLoading={recent.isPending}
      />
      <ContainerCard details={data} />
    </div>
  );
}
