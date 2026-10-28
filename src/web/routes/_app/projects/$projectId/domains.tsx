import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLinkIcon, GlobeIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { z } from "zod";

import { domainInputSchema } from "@/shared/domain.schema";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { FormField } from "@/web/components/form-field";
import { PageHeader } from "@/web/components/page-header";
import { InfoNote } from "@/web/components/project-overview-info";
import { projectQueryOptions } from "@/web/components/project-query";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { StatusPill } from "@/web/components/status-badge";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import { redeployProjectFn } from "@/web/functions/deployments.functions";
import { addDomainFn, removeDomainFn } from "@/web/functions/domains.functions";

export const Route = createFileRoute("/_app/projects/$projectId/domains")({
  head: () => ({ meta: [{ title: "Domínios · Nelcota Deploy" }] }),
  component: DomainsPage,
});

function DomainsPage() {
  const { projectId } = Route.useParams();
  const can = useCan();
  const canEdit = can("domain:write");
  const project = useQuery(projectQueryOptions(projectId));
  const projectKey = ["project", projectId];

  const redeploy = useAction({
    action: () => redeployProjectFn({ data: { projectId } }),
    successMessage: "Redeploy colocado na fila",
    invalidate: [projectKey, ["deployments"]],
  });
  const remove = useAction({
    action: (domainId: string) => removeDomainFn({ data: { projectId, domainId } }),
    successMessage: "Domínio removido",
    invalidate: [projectKey],
  });

  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }
  const details = project.data;
  const canRedeploy = details?.project.currentDeploymentId != null && can("deployment:create");

  return (
    <>
      <PageHeader
        title="Domínios"
        description="Endereços públicos que levam até a sua aplicação."
      />
      <InfoNote
        details="Crie um registro DNS do tipo A apontando o domínio para o IP deste servidor. Com DNS e ACME configurados, o Traefik emite o certificado HTTPS (Let's Encrypt) sozinho. O roteamento muda quando o contêiner é recriado."
        action={
          canRedeploy ? (
            <Button
              variant="outline"
              size="sm"
              disabled={redeploy.isPending}
              onClick={() => redeploy.mutate()}
            >
              <RefreshCwIcon aria-hidden />
              Aplicar agora
            </Button>
          ) : null
        }
      >
        Depois de alterar domínios, clique em Aplicar agora.
      </InfoNote>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Domínios do projeto</CardTitle>
          {details == null ? null : (
            <CardDescription>
              Porta interna de destino: {details.project.internalPort}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {details == null ? (
            <ListSkeleton rows={2} />
          ) : (
            <DomainList
              domains={details.domains}
              canEdit={canEdit}
              onRemove={(domainId) => remove.mutate(domainId)}
            />
          )}
        </CardContent>
      </Card>

      {canEdit ? <AddDomainForm projectId={projectId} /> : null}
    </>
  );
}

type DomainItem = {
  readonly id: string | null;
  readonly hostname: string;
  readonly httpsEnabled: boolean;
  readonly automatic: boolean;
};

function DomainList({
  domains,
  canEdit,
  onRemove,
}: {
  readonly domains: readonly DomainItem[];
  readonly canEdit: boolean;
  readonly onRemove: (domainId: string) => void;
}) {
  if (domains.length === 0) {
    return (
      <EmptyState
        icon={GlobeIcon}
        title="Nenhum domínio configurado"
        description="Adicione um domínio ou defina um domínio base nas configurações para gerar endereços automáticos."
      />
    );
  }
  return (
    <ul className="divide-y">
      {domains.map((domain) => (
        <li
          key={domain.hostname}
          className="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <a
              href={`${domain.httpsEnabled ? "https" : "http"}://${domain.hostname}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 truncate font-mono text-sm hover:underline"
            >
              {domain.hostname}
              <ExternalLinkIcon aria-hidden className="size-3.5" />
            </a>
            <StatusPill
              tone={domain.httpsEnabled ? "success" : "neutral"}
              label={domain.httpsEnabled ? "HTTPS" : "Somente HTTP"}
            />
            {domain.automatic ? <Badge variant="secondary">Automático</Badge> : null}
          </div>
          {canEdit && domain.id != null ? (
            <RemoveDomainButton
              domainId={domain.id}
              hostname={domain.hostname}
              onRemove={onRemove}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RemoveDomainButton({
  domainId,
  hostname,
  onRemove,
}: {
  readonly domainId: string;
  readonly hostname: string;
  readonly onRemove: (domainId: string) => void;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" aria-label={`Remover ${hostname}`}>
          <Trash2Icon aria-hidden />
          Remover
        </Button>
      }
      title={`Remover ${hostname}?`}
      description="O domínio deixa de ser roteado quando o contêiner for recriado."
      confirmLabel="Remover"
      destructive
      onConfirm={() => onRemove(domainId)}
    />
  );
}

function AddDomainForm({ projectId }: { readonly projectId: string }) {
  const [hostname, setHostname] = useState("");
  const [httpsEnabled, setHttpsEnabled] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const add = useAction({
    action: (domain: z.output<typeof domainInputSchema>) =>
      addDomainFn({ data: { projectId, domain } }),
    successMessage: "Domínio adicionado",
    invalidate: [["project", projectId]],
    onSuccess: () => setHostname(""),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = domainInputSchema.safeParse({ hostname, httpsEnabled });
    if (parsed.success === false) {
      setErrors(z.flattenError(parsed.error).fieldErrors.hostname ?? []);
      return;
    }
    setErrors([]);
    add.mutate(parsed.data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Adicionar domínio</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4 sm:flex-row sm:items-start" onSubmit={submit}>
          <div className="flex-1">
            <FormField id="domain-hostname" label="Domínio" errors={errors}>
              {(props) => (
                <Input
                  {...props}
                  placeholder="app.exemplo.com"
                  autoComplete="off"
                  className="font-mono"
                  value={hostname}
                  onChange={(event) => setHostname(event.target.value)}
                />
              )}
            </FormField>
          </div>
          <div className="flex items-center gap-2 sm:pt-8">
            <Switch id="domain-https" checked={httpsEnabled} onCheckedChange={setHttpsEnabled} />
            <Label htmlFor="domain-https">HTTPS automático</Label>
          </div>
          <Button type="submit" className="sm:mt-6" disabled={add.isPending}>
            <PlusIcon aria-hidden />
            Adicionar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
