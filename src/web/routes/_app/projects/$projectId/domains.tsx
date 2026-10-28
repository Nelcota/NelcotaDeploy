import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ExternalLinkIcon,
  GlobeIcon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { z } from "zod";

import { domainInputSchema } from "@/shared/domain.schema";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { FormField } from "@/web/components/form-field";
import { List, ListRow } from "@/web/components/layout";
import { TabHeader } from "@/web/components/project-header";
import { projectQueryOptions } from "@/web/components/project-query";
import { ErrorState, ListSkeleton } from "@/web/components/states";
import { Button } from "@/web/components/ui/button";
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
      <TabHeader
        icon={GlobeIcon}
        title="Domínios"
        count={details?.domains.length ?? null}
        description={
          <span>
            Endereços públicos da aplicação
            {details == null ? "" : `, encaminhados à porta ${details.project.internalPort}`}. O
            roteamento muda quando o contêiner é recriado
            {canRedeploy ? (
              <>
                {" — "}
                <button
                  type="button"
                  disabled={redeploy.isPending}
                  onClick={() => redeploy.mutate()}
                  className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none disabled:opacity-50"
                >
                  aplicar agora
                </button>
              </>
            ) : null}
            .
          </span>
        }
      />
      {details == null ? (
        <ListSkeleton rows={2} />
      ) : (
        <List>
          <DomainRows
            domains={details.domains}
            canEdit={canEdit}
            onRemove={(domainId) => remove.mutate(domainId)}
          />
          {canEdit ? <AddDomainForm projectId={projectId} /> : null}
        </List>
      )}
      <details className="text-sm text-muted-foreground">
        <summary className="w-fit cursor-pointer text-xs font-medium text-faint hover:text-foreground focus-visible:text-foreground focus-visible:outline-none">
          Como configurar DNS e HTTPS
        </summary>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed">
          Crie um registro DNS do tipo A apontando o domínio para o IP deste servidor. Com DNS e
          ACME configurados, o Traefik emite o certificado HTTPS (Let&apos;s Encrypt) sozinho.
        </p>
      </details>
    </>
  );
}

type DomainItem = {
  readonly id: string | null;
  readonly hostname: string;
  readonly httpsEnabled: boolean;
  readonly automatic: boolean;
};

function DomainRows({
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
      <ListRow>
        <GlobeIcon aria-hidden className="size-4 shrink-0 text-faint" />
        <p className="text-sm text-muted-foreground">
          Nenhum domínio ainda. Adicione um abaixo ou defina um domínio base em Administração.
        </p>
      </ListRow>
    );
  }
  return domains.map((domain) => (
    <ListRow key={domain.hostname} accent={domain.httpsEnabled ? "success" : "neutral"}>
      {domain.httpsEnabled ? (
        <LockIcon aria-label="HTTPS" className="size-4 shrink-0 text-success" />
      ) : (
        <LockOpenIcon aria-label="Somente HTTP" className="size-4 shrink-0 text-faint" />
      )}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="truncate font-mono text-sm">{domain.hostname}</span>
        <span className="text-xs text-faint">
          {domain.httpsEnabled ? "HTTPS" : "somente HTTP"}
          {domain.automatic ? " · automático" : ""}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" asChild>
          <a
            href={`${domain.httpsEnabled ? "https" : "http"}://${domain.hostname}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLinkIcon aria-hidden />
            Abrir
            <span className="sr-only">(abre em nova aba)</span>
          </a>
        </Button>
        {canEdit && domain.id != null ? (
          <RemoveDomainButton domainId={domain.id} hostname={domain.hostname} onRemove={onRemove} />
        ) : null}
      </div>
    </ListRow>
  ));
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
    <form
      className="flex flex-col gap-3 bg-surface-sunken/40 px-5 py-4 sm:flex-row sm:items-start"
      onSubmit={submit}
      aria-label="Adicionar domínio"
    >
      <div className="flex-1">
        <FormField id="domain-hostname" label="Novo domínio" errors={errors}>
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
        <Label htmlFor="domain-https">HTTPS</Label>
      </div>
      <Button type="submit" variant="outline" className="sm:mt-6" disabled={add.isPending}>
        <PlusIcon aria-hidden />
        Adicionar
      </Button>
    </form>
  );
}
