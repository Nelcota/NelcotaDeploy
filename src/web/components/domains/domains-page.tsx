import { Link, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import { List } from "@/web/components/layout/layout";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";

import { AddDomainForm } from "./add-domain-form";
import { DomainRows } from "./domain-rows";
import { DOMAIN_SETUP_ID } from "./domains";
import { DomainSetup } from "./setup/domain-setup";
import { useDomainUptime } from "./uptime/use-domain-uptime";
import { useProjectDomains } from "./use-project-domains";

/** Associates public addresses with the application; DNS is configured on its own page. */
export function DomainsPage({ projectId }: { readonly projectId: string }) {
  const { project, canEdit, remove, applyChanges } = useProjectDomains(projectId);
  const uptime = useDomainUptime(projectId, {
    releaseId: project.data?.liveDeployment?.id ?? null,
    trackProgress: true,
  });
  const setupRequested = useLocation({ select: (location) => location.hash === DOMAIN_SETUP_ID });
  const setupAvailable = project.data?.liveDeployment != null;
  useEffect(() => {
    if (setupRequested && setupAvailable) {
      const setup = document.getElementById(DOMAIN_SETUP_ID);
      setup?.focus({ preventScroll: true });
      setup?.scrollIntoView({ block: "start" });
    }
  }, [setupAvailable, setupRequested]);
  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }
  const details = project.data;

  return (
    <>
      <DomainsHeader details={details} projectId={projectId} />
      {details?.liveDeployment == null ? null : (
        <DomainSetup
          details={details}
          domain={details.domains.at(0)}
          canEdit={canEdit}
          applyChanges={applyChanges}
          uptime={uptime}
        />
      )}
      {details == null ? (
        <ListSkeleton rows={2} />
      ) : (
        <List>
          {canEdit ? (
            <AddDomainForm
              projectId={projectId}
              firstDomain={details.liveDeployment != null && details.domains.length === 0}
            />
          ) : null}
          <DomainRows
            projectId={projectId}
            domains={details.domains}
            uptime={uptime.byHostname}
            setupShown={details.liveDeployment != null}
            canEdit={canEdit}
            onRemove={(domainId) => remove.mutate(domainId)}
          />
        </List>
      )}
    </>
  );
}

function DomainsHeader({
  details,
  projectId,
}: {
  readonly details: ProjectDetails | undefined;
  readonly projectId: string;
}) {
  return (
    <TabHeader
      title="Domínios da aplicação"
      count={details?.domains.length ?? null}
      actions={
        details?.liveDeployment != null ? null : (
          <Button variant="outline" asChild>
            <Link to="/projects/$projectId/dns" params={{ projectId }}>
              Ver registros DNS dos domínios
            </Link>
          </Button>
        )
      }
    />
  );
}
