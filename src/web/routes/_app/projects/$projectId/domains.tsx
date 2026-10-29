import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ExternalLinkIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  ServerIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import type { z } from "zod";

import { domainInputSchema } from "@/shared/domain.schema";
import { ApplyChangesBanner, useApplyChanges } from "@/web/components/apply-changes-banner";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { CopyButton } from "@/web/components/copy-button";
import { errorMessages, visibleErrors } from "@/web/components/form-field";
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
import { addDomainFn, getServerAddressFn, removeDomainFn } from "@/web/functions/domains.functions";

export const Route = createFileRoute("/_app/projects/$projectId/domains")({
  head: () => ({ meta: [{ title: "Domínios · Nelcota Deploy" }] }),
  component: DomainsPage,
});

// The server's address rarely changes; asking once per visit is enough.
const SERVER_ADDRESS_STALE_IN_MS = 10 * 60 * 1000;

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
  const serverAddress = useQuery({
    queryKey: ["server-address"],
    queryFn: () => getServerAddressFn(),
    staleTime: SERVER_ADDRESS_STALE_IN_MS,
  });
  const remove = useAction({
    action: (domainId: string) => removeDomainFn({ data: { projectId, domainId } }),
    successMessage: "Domínio removido",
    invalidate: [["project", projectId]],
  });
  const details = project.data;
  const canRedeploy = details?.project.currentDeploymentId != null && can("deployment:create");
  // Routing only changes when the container is recreated; the server tracks what is pending.
  const { redeploy, showBanner: showApplyBanner } = useApplyChanges(
    projectId,
    details?.pendingRuntimeChanges === true,
    canRedeploy,
  );

  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }
  const automaticHostname = details?.domains.find((domain) => domain.automatic)?.hostname ?? null;

  return (
    <>
      <TabHeader
        title="Domínios"
        count={details?.domains.length ?? null}
        description={
          details == null
            ? "Endereços públicos da aplicação."
            : `Endereços públicos da aplicação, encaminhados à porta ${details.project.internalPort} do contêiner.`
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
          {canEdit ? <AddDomainForm projectId={projectId} /> : null}
          <DomainRows
            domains={details.domains}
            canEdit={canEdit}
            onRemove={(domainId) => remove.mutate(domainId)}
          />
        </List>
      )}
      <DnsCard automaticHostname={automaticHostname} serverAddress={serverAddress.data ?? null} />
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
    <ListRow key={domain.hostname}>
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
          {index === 0 ? <Tag icon={StarIcon}>Principal</Tag> : null}
          <Tag icon={domain.httpsEnabled ? LockIcon : LockOpenIcon}>
            {domain.httpsEnabled ? "HTTPS" : "Somente HTTP"}
          </Tag>
          {domain.automatic ? <Tag icon={LinkIcon}>Automático</Tag> : null}
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

function AddDomainForm({ projectId }: { readonly projectId: string }) {
  const add = useAction({
    action: (domain: z.output<typeof domainInputSchema>) =>
      addDomainFn({ data: { projectId, domain } }),
    successMessage: "Domínio adicionado",
    invalidate: [["project", projectId]],
    onSuccess: () => form.reset(),
  });
  const form = useForm({
    defaultValues: { hostname: "", httpsEnabled: true },
    validators: { onChange: domainInputSchema },
    onSubmit: ({ value }) => add.mutate(domainInputSchema.parse(value)),
  });

  return (
    <form
      noValidate
      className="space-y-2 bg-well/40 px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      aria-label="Adicionar domínio"
    >
      <label htmlFor="domain-hostname" className="text-sm font-medium">
        Adicionar domínio
      </label>
      <form.Field name="hostname">
        {(field) => {
          const [error] = errorMessages(visibleErrors(form, field.state.meta));
          return (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div
                  className={cn(
                    "flex h-11 min-w-0 flex-1 items-center rounded-lg bg-secondary ring-1 ring-border transition-[box-shadow,background-color] ring-inset focus-within:bg-surface focus-within:ring-3 focus-within:ring-ring/25 hover:ring-input",
                    error == null ? "" : "ring-destructive/60",
                  )}
                >
                  <form.Subscribe selector={(state) => state.values.httpsEnabled}>
                    {(httpsEnabled) => (
                      <span aria-hidden className="pl-3.5 font-mono text-sm text-faint select-none">
                        {httpsEnabled ? "https://" : "http://"}
                      </span>
                    )}
                  </form.Subscribe>
                  <Input
                    id="domain-hostname"
                    placeholder="app.exemplo.com"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={error != null}
                    aria-describedby="domain-hostname-error"
                    className="h-full rounded-none bg-transparent pl-0.5 font-mono ring-0 hover:ring-0 focus-visible:bg-transparent focus-visible:ring-0"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </div>
                <form.Field name="httpsEnabled">
                  {(httpsField) => (
                    <div className="flex items-center gap-2">
                      <Switch
                        id="domain-https"
                        checked={httpsField.state.value}
                        onCheckedChange={httpsField.handleChange}
                        title="Certificado Let's Encrypt emitido automaticamente"
                      />
                      <label htmlFor="domain-https" className="text-sm">
                        HTTPS
                      </label>
                    </div>
                  )}
                </form.Field>
                <Button type="submit" disabled={add.isPending || field.state.value.trim() === ""}>
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
            </>
          );
        }}
      </form.Field>
    </form>
  );
}

/** The DNS record a custom domain needs, pointing at the automatic hostname when there is one. */
function DnsCard({
  automaticHostname,
  serverAddress,
}: {
  readonly automaticHostname: string | null;
  /** Public IP of this server, when it could be found from PUBLIC_URL. */
  readonly serverAddress: string | null;
}) {
  const serverIp =
    serverAddress == null ? (
      <span className="text-sm">IP deste servidor</span>
    ) : (
      <>
        <span className="font-mono text-sm">{serverAddress}</span>
        <CopyButton text={serverAddress} label="Copiar" />
      </>
    );
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={ServerIcon} title="Configurar DNS" />
      <p className="text-sm text-muted-foreground">
        No provedor do domínio, crie o registro abaixo. Com HTTPS ativo, o certificado Let&apos;s
        Encrypt é emitido sozinho assim que o DNS responder.
      </p>
      <dl className="grid gap-x-8 gap-y-4 rounded-lg p-4 ring-1 ring-border/70 sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-start">
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Tipo</dt>
          <dd className="font-mono text-sm">{automaticHostname == null ? "A" : "CNAME"}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Nome</dt>
          <dd className="text-sm">o subdomínio, como app</dd>
        </div>
        <div className="min-w-0 space-y-1">
          <dt className="text-xs text-muted-foreground">Valor</dt>
          <dd className="flex flex-wrap items-center gap-2">
            {automaticHostname == null ? (
              serverIp
            ) : (
              <>
                <span className="min-w-0 font-mono text-sm break-all">{automaticHostname}</span>
                <CopyButton text={automaticHostname} label="Copiar" />
              </>
            )}
          </dd>
        </div>
      </dl>
      {automaticHostname == null ? null : (
        <p className="text-xs text-faint">
          O CNAME aponta para o domínio automático do projeto. Para a raiz do domínio (sem
          subdomínio), use um registro A com o IP deste servidor
          {serverAddress == null ? "" : `: ${serverAddress}`}.
        </p>
      )}
    </Card>
  );
}
