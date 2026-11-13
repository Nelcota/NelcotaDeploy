import { Link } from "@tanstack/react-router";
import { CircleCheckIcon } from "lucide-react";
import { useId } from "react";

import { DOMAIN_SETUP_ID } from "@/web/components/domains/domains";
import { useProjectDomainAccess } from "@/web/components/domains/uptime";
import { Button } from "@/web/components/ui/button";

import { OpenAppButton } from "../project-actions";
import { type ProjectDetails, projectAppUrl } from "../project-query";

type PublicationDetails = {
  readonly liveDeployment: { readonly id: string; readonly isFirstPublication: boolean } | null;
};

/** Matches the first publication while it is still the project's current version. */
export function firstPublicationConfirmation(
  details: PublicationDetails | undefined,
  deploymentId?: string,
): boolean {
  if (
    details?.liveDeployment?.isFirstPublication !== true ||
    (deploymentId != null && details.liveDeployment.id !== deploymentId)
  ) {
    return false;
  }

  return true;
}

/** Confirms the first publication and provides the next action at the top of the page. */
export function FirstPublicationConfirmation({ details }: { readonly details: ProjectDetails }) {
  const headingId = useId();
  const projectId = details.project.id;
  const { domain, access } = useProjectDomainAccess(details);
  const url = access === "ready" ? projectAppUrl(details) : null;
  const heading = url == null ? "Primeira versão publicada" : "Primeira versão no ar";

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border border-success/25 bg-success/8 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <CircleCheckIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="min-w-0 space-y-1">
          <h2 id={headingId} className="text-base font-semibold" aria-live="polite">
            {heading}
          </h2>
          {url == null ? (
            <p className="text-sm text-muted-foreground">
              {domain == null
                ? "Adicione um domínio e configure o DNS para abrir o app pelo navegador."
                : "Acompanhe a configuração e a verificação do endereço em Domínios."}
            </p>
          ) : null}
        </div>
      </div>
      {url == null ? (
        <Button asChild className="min-h-11 w-full sm:w-auto">
          <Link to="/projects/$projectId/domains" params={{ projectId }} hash={DOMAIN_SETUP_ID}>
            {domain == null && details.permissions.includes("domain:write")
              ? "Configurar domínio"
              : "Ver domínios"}
          </Link>
        </Button>
      ) : (
        <OpenAppButton url={url} prominent />
      )}
    </section>
  );
}
