import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ExternalLinkIcon,
  GlobeIcon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { z } from "zod";

import { domainInputSchema } from "@/shared/domain.schema";
import { ApplyChangesBanner } from "@/web/components/apply-changes-banner";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { CopyButton } from "@/web/components/copy-button";
import { CardTitleRow, List, ListRow, Tag } from "@/web/components/layout";
import { TabHeader } from "@/web/components/project-header";
import { projectQueryOptions } from "@/web/components/project-query";
import { ErrorState, ListSkeleton } from "@/web/components/states";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { cn } from "@/web/components/ui/class-names";
import { Input } from "@/web/components/ui/input";
import { Switch } from "@/web/components/ui/switch";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import { redeployProjectFn } from "@/web/functions/deployments.functions";
import { addDomainFn, removeDomainFn } from "@/web/functions/domains.functions";

export const Route = createFileRoute("/_app/projects/$projectId/domains")({
  head: () => ({ meta: [{ title: "Domínios · Nelcota Deploy" }] }),
  component: DomainsPage,
});

type DomainItem = {
  readonly id: string | null;
  readonly hostname: string;
  readonly httpsEnabled: boolean;
  readonly automatic: boolean;
};

function DomainsPage() {
  const { projectId } = Route.useParams();
  const can = useCan();
  const canEdit = can("domain:write");
  const project = useQuery(projectQueryOptions(projectId));
  const projectKey = ["project", projectId];
  // Routing only changes when the container is recreated, so changes made here wait for it.
  const [pendingApply, setPendingApply] = useState(false);

  const redeploy = useAction({
    action: () => redeployProjectFn({ data: { projectId } }),
    successMessage: "Redeploy colocado na fila",
    invalidate: [projectKey, ["deployments"]],
    onSuccess: () => setPendingApply(false),
  });
  const remove = useAction({
    action: (domainId: string) => removeDomainFn({ data: { projectId, domainId } }),
    successMessage: "Domínio removido",
    invalidate: [projectKey],
    onSuccess: () => setPendingApply(true),
  });

  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }
  const details = project.data;
  const canRedeploy = details?.project.currentDeploymentId != null && can("deployment:create");
  const showApplyBanner = pendingApply && canRedeploy;
  const automaticHostname = details?.domains.find((domain) => domain.automatic)?.hostname ?? null;

  return (
    <>
      <TabHeader
        icon={GlobeIcon}
        title="Domínios"
        count={details?.domains.length ?? null}
        description={
          details == null
            ? "Endereços públicos da aplicação."
            : `Endereços públicos da aplicação, encaminhados à porta ${details.project.internalPort} do contêiner.`
        }
        actions={
          canRedeploy && showApplyBanner === false ? (
            <Button
              variant="outline"
              disabled={redeploy.isPending}
              onClick={() => redeploy.mutate()}
              title="Recria o contêiner com a imagem atual para aplicar os domínios salvos"
            >
              <RefreshCwIcon aria-hidden />
              Aplicar com redeploy
            </Button>
          ) : null
        }
      />
      {showApplyBanner ? (
        <ApplyChangesBanner
          message="Os domínios mudaram. O roteamento só é atualizado quando o contêiner é recriado."
          applying={redeploy.isPending}
          onApply={() => redeploy.mutate()}
        />
      ) : null}
      {details == null ? (
        <ListSkeleton rows={2} />
      ) : (
        <List>
          {canEdit ? (
            <AddDomainForm projectId={projectId} onAdded={() => setPendingApply(true)} />
          ) : null}
          <DomainRows
            domains={details.domains}
            canEdit={canEdit}
            onRemove={(domainId) => remove.mutate(domainId)}
          />
        </List>
      )}
      <DnsCard automaticHostname={automaticHostname} />
    </>
  );
}

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
          Nenhum domínio ainda.{" "}
          {canEdit
            ? "Adicione um acima ou defina um domínio base em Administração."
            : "Um administrador pode definir um domínio base em Administração."}
        </p>
      </ListRow>
    );
  }
  return domains.map((domain, index) => (
    <ListRow key={domain.hostname} accent={domain.httpsEnabled ? "success" : "neutral"}>
      <span
        aria-hidden
        className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-well ring-1 ring-border/70 sm:flex"
      >
        {domain.httpsEnabled ? (
          <LockIcon className="size-4 text-success" />
        ) : (
          <LockOpenIcon className="size-4 text-faint" />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <a
          href={`${domain.httpsEnabled ? "https" : "http"}://${domain.hostname}`}
          target="_blank"
          rel="noreferrer noopener"
          className="group inline-flex max-w-full items-center gap-1.5 rounded-sm font-mono text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="truncate">{domain.hostname}</span>
          <ExternalLinkIcon
            aria-hidden
            className="size-3.5 shrink-0 text-faint group-hover:text-foreground"
          />
          <span className="sr-only">(abre em nova aba)</span>
        </a>
        <div className="flex flex-wrap gap-1.5">
          {index === 0 ? <Tag>Principal</Tag> : null}
          <Tag>{domain.httpsEnabled ? "HTTPS" : "Somente HTTP"}</Tag>
          {domain.automatic ? <Tag>Automático</Tag> : null}
        </div>
      </div>
      {canEdit && domain.id != null ? (
        <RemoveDomainButton domainId={domain.id} hostname={domain.hostname} onRemove={onRemove} />
      ) : null}
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
        <Button variant="ghost" size="icon-sm" aria-label={`Remover ${hostname}`}>
          <Trash2Icon aria-hidden />
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

function AddDomainForm({
  projectId,
  onAdded,
}: {
  readonly projectId: string;
  readonly onAdded: () => void;
}) {
  const [hostname, setHostname] = useState("");
  const [httpsEnabled, setHttpsEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const add = useAction({
    action: (domain: z.output<typeof domainInputSchema>) =>
      addDomainFn({ data: { projectId, domain } }),
    successMessage: "Domínio adicionado",
    invalidate: [["project", projectId]],
    onSuccess: () => {
      setHostname("");
      onAdded();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = domainInputSchema.safeParse({ hostname, httpsEnabled });
    if (parsed.success === false) {
      setError(z.flattenError(parsed.error).fieldErrors.hostname?.[0] ?? "Domínio inválido.");
      return;
    }
    setError(null);
    add.mutate(parsed.data);
  };

  return (
    <form
      noValidate
      className="space-y-2 bg-well/40 px-5 py-4"
      onSubmit={submit}
      aria-label="Adicionar domínio"
    >
      <label htmlFor="domain-hostname" className="text-sm font-medium">
        Adicionar domínio
      </label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div
          className={cn(
            "flex h-11 min-w-0 flex-1 items-center rounded-lg bg-secondary ring-1 ring-border transition-[box-shadow,background-color] ring-inset focus-within:bg-surface focus-within:ring-3 focus-within:ring-ring/25 hover:ring-input",
            error == null ? "" : "ring-destructive/60",
          )}
        >
          <span aria-hidden className="pl-3.5 font-mono text-sm text-faint select-none">
            {httpsEnabled ? "https://" : "http://"}
          </span>
          <Input
            id="domain-hostname"
            placeholder="app.exemplo.com"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error != null}
            aria-describedby="domain-hostname-error"
            className="h-full rounded-none bg-transparent pl-0.5 font-mono ring-0 hover:ring-0 focus-visible:bg-transparent focus-visible:ring-0"
            value={hostname}
            onChange={(event) => {
              setHostname(event.target.value);
              setError(null);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="domain-https" checked={httpsEnabled} onCheckedChange={setHttpsEnabled} />
          <label htmlFor="domain-https" className="text-sm">
            HTTPS
          </label>
        </div>
        <Button type="submit" disabled={add.isPending || hostname.trim() === ""}>
          <PlusIcon aria-hidden />
          Adicionar
        </Button>
      </div>
      <p
        id="domain-hostname-error"
        aria-live="polite"
        className="text-xs font-medium text-destructive empty:hidden"
      >
        {error ?? ""}
      </p>
    </form>
  );
}

/** The DNS record a custom domain needs, pointing at the automatic hostname when there is one. */
function DnsCard({ automaticHostname }: { readonly automaticHostname: string | null }) {
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={ServerIcon} title="Configurar DNS" />
      <p className="text-sm text-muted-foreground">
        No provedor do domínio, crie o registro abaixo. Com HTTPS ativo, o certificado Let&apos;s
        Encrypt é emitido sozinho assim que o DNS responder.
      </p>
      <div className="overflow-x-auto rounded-lg ring-1 ring-border/70">
        <table className="w-full text-sm">
          <thead className="bg-well/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Tipo
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Nome
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Valor
              </th>
              <th scope="col" className="px-4 py-2">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="font-mono">
            <tr className="border-t border-border/70">
              <td className="px-4 py-3">{automaticHostname == null ? "A" : "CNAME"}</td>
              <td className="px-4 py-3 font-sans text-muted-foreground">seu domínio</td>
              <td className="px-4 py-3 break-all">
                {automaticHostname ?? (
                  <span className="font-sans text-muted-foreground">IP deste servidor</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {automaticHostname == null ? null : (
                  <CopyButton text={automaticHostname} label="Copiar" />
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {automaticHostname == null ? null : (
        <p className="text-xs text-faint">
          O CNAME aponta para o domínio automático do projeto. Para a raiz do domínio (sem
          subdomínio), use um registro A com o IP deste servidor.
        </p>
      )}
    </Card>
  );
}
