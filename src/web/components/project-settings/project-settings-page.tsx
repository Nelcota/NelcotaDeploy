import { useQuery } from "@tanstack/react-query";

import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { type ProjectDetails, projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";
import { StagingSection } from "@/web/components/staging/staging-section";

import { DangerZone } from "./danger-zone";
import { ProjectSettingsForm } from "./project-settings-form";
import {
  type ProjectSettingsSection,
  visibleSettingsSections,
} from "./project-settings-navigation";
import { RepositoryTokenSection } from "./repository-token-section";
import { ServerSection } from "./server-section";
import { TeamSection } from "./team/team-section";
import { VolumesSection } from "./volumes/volumes-section";

function SettingsContent({
  project,
  section,
  environments,
}: {
  readonly project: ProjectDetails["project"];
  readonly section: ProjectSettingsSection;
  readonly environments: ProjectDetails["environments"];
}) {
  const can = useCan();
  switch (section) {
    case "team":
      return project.parentProjectId == null ? (
        <TeamSection projectId={project.id} />
      ) : (
        <p>A equipe é gerenciada no projeto de produção.</p>
      );
    case "staging":
      return project.parentProjectId == null ? (
        <StagingSection
          projectId={project.id}
          stagingId={environments.stagingId}
          canEdit={can("project:write")}
        />
      ) : (
        <p>Este projeto já é um ambiente de staging.</p>
      );
    case "volumes":
      return (
        <VolumesSection
          projectId={project.id}
          canEdit={can("project:write")}
          canDeleteData={can("project:delete")}
        />
      );
    case "server":
      return (
        <ServerSection
          projectId={project.id}
          serverId={project.serverId}
          deployed={project.currentDeploymentId != null}
        />
      );
    case "deletion":
      return <DangerZone projectId={project.id} slug={project.slug} />;
    case "identity":
    case "repository":
    case "build":
    case "runtime":
    case "automation":
      return (
        <>
          <ProjectSettingsForm
            key={`${project.id}:${section}`}
            projectId={project.id}
            project={project}
            canEdit={can("project:write")}
            section={section}
          />
          {section === "repository" && can("project:approve") ? (
            <RepositoryTokenSection projectId={project.id} hasToken={project.hasRepositoryToken} />
          ) : null}
        </>
      );
  }
}

/** Renders only the function owned by the current settings route. */
export function ProjectSettingsPage({
  projectId,
  section,
}: {
  readonly projectId: string;
  readonly section: ProjectSettingsSection;
}) {
  const details = useQuery(projectQueryOptions(projectId));
  const can = useCan();
  const destination = visibleSettingsSections(can).find((item) => item.id === section);
  if (destination == null) {
    return <p role="alert">Você não tem permissão para acessar esta página.</p>;
  }
  if (details.isError) {
    return <ErrorState error={details.error} onRetry={() => void details.refetch()} />;
  }
  if (details.data == null) {
    return <ListSkeleton rows={6} />;
  }
  return (
    <div className="space-y-6">
      <TabHeader title={destination.label} />
      {can("project:write") || section === "server" || section === "deletion" ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          Você pode ver estes ajustes, mas só quem tem permissão de edição pode alterá-los.
        </p>
      )}
      <SettingsContent
        project={details.data.project}
        environments={details.data.environments}
        section={section}
      />
    </div>
  );
}
