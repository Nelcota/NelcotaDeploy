import { useQuery } from "@tanstack/react-query";

import { type ProjectDetails, projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";
import { StagingSection } from "@/web/components/staging/staging-section";

import { DangerZone } from "./danger-zone";
import {
  type ProjectSettingsSection,
  visibleSettingsSections,
} from "./navigation/settings-destinations";
import { ProjectSettingsForm } from "./project-settings-form";
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
  const { data } = useQuery(projectQueryOptions(projectId));
  const can = useCan();
  if (data == null) {
    return null;
  }

  if (visibleSettingsSections(can).some((item) => item.id === section) === false) {
    return <p role="alert">Você não tem permissão para acessar esta página.</p>;
  }

  return (
    <div className="space-y-4">
      {can("project:write") ||
      section === "server" ||
      section === "deletion" ||
      section === "team" ? null : (
        <p className="rounded-lg bg-well px-3 py-2 text-sm text-muted-foreground">
          Somente leitura. Para alterar estes ajustes, você precisa de permissão de edição.
        </p>
      )}
      <SettingsContent project={data.project} environments={data.environments} section={section} />
    </div>
  );
}
