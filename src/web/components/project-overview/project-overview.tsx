import { useQuery } from "@tanstack/react-query";

import { ListSkeleton } from "@/web/components/layout/states";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";

import { ConfigurationCard, ContainerCard } from "./fact-cards";
import { PreviewsCard } from "./previews-card";
import { RecentDeploymentsCard } from "./recent-deployments-card";
import { ResourcesCard } from "./resources/resources-card";
import { SituationCard } from "./situation/situation-card";
import { useRecentDeployments } from "./use-recent-deployments";

/** Overview of one project: current situation, resources, deployments and settings. */
export function ProjectOverview({ projectId }: { readonly projectId: string }) {
  const details = useQuery(projectQueryOptions(projectId));
  const recent = useRecentDeployments(projectId);
  const can = useCan();

  if (details.data == null) {
    return <ListSkeleton rows={4} />;
  }
  const data = details.data;
  return (
    <div className="space-y-6">
      <SituationCard
        details={data}
        latest={recent.data?.[0] ?? null}
        latestLoading={recent.isPending}
      />
      {/* Both rows share one three-column grid so card edges line up. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <ResourcesCard projectId={projectId} />
        </div>
        <RecentDeploymentsCard
          projectId={projectId}
          deployments={recent.data ?? null}
          canDeploy={can("deployment:create") && data.project.deploymentsApproved}
        />
      </div>
      <PreviewsCard
        projectId={projectId}
        branch={data.project.branch}
        enabled={data.project.previewsEnabled}
      />
      {/* Domains, repository and branch are already in the project header. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ContainerCard details={data} />
        <ConfigurationCard details={data} />
      </div>
    </div>
  );
}
