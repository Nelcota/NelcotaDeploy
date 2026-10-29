import { useQuery } from "@tanstack/react-query";

import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";

import { DangerZone } from "./danger-zone";
import { ProjectSettingsForm } from "./project-settings-form";
import { RepositoryTokenSection } from "./repository-token-section";
import { ServerSection } from "./server-section";

/** Repository, build and runtime settings of one project, plus its token and deletion. */
export function ProjectSettingsPage({ projectId }: { readonly projectId: string }) {
  const details = useQuery(projectQueryOptions(projectId));
  const can = useCan();

  if (details.isError) {
    return <ErrorState error={details.error} onRetry={() => void details.refetch()} />;
  }
  if (details.data == null) {
    return <ListSkeleton rows={6} />;
  }
  const { project } = details.data;

  return (
    <div className="space-y-6">
      <TabHeader title="Ajustes do projeto" description="As mudanças valem no próximo deploy." />
      {can("project:write") ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          Você pode ver estes ajustes, mas só quem tem permissão de edição pode alterá-los.
        </p>
      )}
      <ProjectSettingsForm
        key={project.updatedAt}
        projectId={projectId}
        project={project}
        canEdit={can("project:write")}
      >
        {can("project:approve") ? (
          <RepositoryTokenSection projectId={projectId} hasToken={project.hasRepositoryToken} />
        ) : null}
        {can("settings:write") ? (
          <ServerSection
            projectId={projectId}
            serverId={project.serverId}
            deployed={project.currentDeploymentId != null}
          />
        ) : null}
        {can("project:delete") ? <DangerZone projectId={projectId} slug={project.slug} /> : null}
      </ProjectSettingsForm>
    </div>
  );
}
