import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useNow } from "@/web/components/clock/use-now";
import { ErrorState } from "@/web/components/layout/states";
import { LogViewer } from "@/web/components/monitoring/log-viewer";
import { projectQueryOptions } from "@/web/components/projects/project-query";

import { DeploymentPicker } from "./deployment-picker";
import { ALL_DEPLOYMENTS, runtimeLogsUrl } from "./runtime-logs";
import {
  CONSOLE_HEIGHT_CLASS,
  ConsoleSkeleton,
  NoContainerState,
  RuntimeLogsHeader,
  RuntimeLogsSection,
} from "./runtime-logs-states";

/** Live container output of one project, for the live deploy, an older one or all of them. */
export function RuntimeLogsPage({ projectId }: { readonly projectId: string }) {
  const now = useNow();
  const project = useQuery(projectQueryOptions(projectId));
  // Null follows the deploy that is live, so a new deploy switches the view by itself.
  const [chosen, setChosen] = useState<string | null>(null);

  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }
  const details = project.data;
  const currentDeploymentId = details?.project.currentDeploymentId ?? null;
  const selected = chosen ?? currentDeploymentId ?? ALL_DEPLOYMENTS;
  const header = <RuntimeLogsHeader details={details} selected={selected} now={now} />;

  if (details == null) {
    return (
      <RuntimeLogsSection>
        {header}
        <ConsoleSkeleton />
      </RuntimeLogsSection>
    );
  }
  if (currentDeploymentId == null) {
    return (
      <RuntimeLogsSection>
        {header}
        <NoContainerState projectId={projectId} />
      </RuntimeLogsSection>
    );
  }
  return (
    <RuntimeLogsSection>
      {header}
      <RuntimeConsole
        projectId={projectId}
        slug={details.project.slug}
        currentDeploymentId={currentDeploymentId}
        selected={selected}
        onSelect={setChosen}
      />
    </RuntimeLogsSection>
  );
}

function RuntimeConsole({
  projectId,
  slug,
  currentDeploymentId,
  selected,
  onSelect,
}: {
  readonly projectId: string;
  readonly slug: string;
  readonly currentDeploymentId: string;
  readonly selected: string;
  readonly onSelect: (deploymentId: string) => void;
}) {
  const now = useNow();
  return (
    <LogViewer
      url={runtimeLogsUrl(projectId, selected)}
      heightClass={CONSOLE_HEIGHT_CLASS}
      downloadName={`${slug}.log`}
      emptyMessage="Aguardando linhas do contêiner…"
      toolbarStart={
        <DeploymentPicker
          projectId={projectId}
          currentDeploymentId={currentDeploymentId}
          selected={selected}
          now={now}
          onChange={onSelect}
        />
      }
    />
  );
}
