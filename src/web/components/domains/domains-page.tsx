import { Link } from "@tanstack/react-router";

import { ApplyChangesBanner } from "@/web/components/deployments/apply-changes-banner";
import { List } from "@/web/components/layout/layout";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";

import { AddDomainForm } from "./add-domain-form";
import { DomainRows } from "./domain-rows";
import { useProjectDomains } from "./use-project-domains";

/** Associates public addresses with the application; DNS is configured on its own page. */
export function DomainsPage({ projectId }: { readonly projectId: string }) {
  const { project, canEdit, remove, applyChanges } = useProjectDomains(projectId);
  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }
  const details = project.data;

  return (
    <>
      <DomainsHeader details={details} projectId={projectId} />
      {applyChanges.showBanner ? (
        <ApplyChangesBanner
          message="Os domínios mudaram. O roteamento só é atualizado quando o contêiner é recriado."
          state={applyChanges}
        />
      ) : null}
      {details == null ? (
        <ListSkeleton rows={2} />
      ) : (
        <List>
          {canEdit ? <AddDomainForm projectId={projectId} /> : null}
          <DomainRows
            domains={details.domains}
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
        <Button variant="outline" asChild>
          <Link to="/projects/$projectId/dns" params={{ projectId }}>
            Ver registros DNS dos domínios
          </Link>
        </Button>
      }
    />
  );
}
