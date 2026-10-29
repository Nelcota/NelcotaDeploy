import { ApplyChangesBanner } from "@/web/components/deployments/apply-changes-banner";
import { List } from "@/web/components/layout/layout";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import type { ProjectDetails } from "@/web/components/projects/project-query";

import { AddDomainForm } from "./add-domain-form";
import { DnsCard } from "./dns-card";
import { DomainRows } from "./domain-rows";
import { useProjectDomains } from "./use-project-domains";

/** Public addresses of one project: list, add, remove, and the DNS record to create. */
export function DomainsPage({ projectId }: { readonly projectId: string }) {
  const { project, canEdit, remove, applyChanges } = useProjectDomains(projectId);
  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }
  const details = project.data;

  return (
    <>
      <DomainsHeader details={details} />
      {applyChanges.showBanner ? (
        <ApplyChangesBanner
          message="Os domínios mudaram. O roteamento só é atualizado quando o contêiner é recriado."
          applying={applyChanges.redeploy.isPending}
          onApply={() => applyChanges.redeploy.mutate()}
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
      <DnsCard automaticHostname={automaticHostnameOf(details)} />
    </>
  );
}

function automaticHostnameOf(details: ProjectDetails | undefined): string | null {
  return details?.domains.find((domain) => domain.automatic)?.hostname ?? null;
}

function DomainsHeader({ details }: { readonly details: ProjectDetails | undefined }) {
  return (
    <TabHeader
      title="Domínios"
      count={details?.domains.length ?? null}
      description={
        details == null
          ? "Endereços públicos da aplicação."
          : `Endereços públicos da aplicação, encaminhados à porta ${details.project.internalPort} do contêiner.`
      }
    />
  );
}
