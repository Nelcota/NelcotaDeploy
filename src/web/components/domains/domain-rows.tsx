import { Link } from "@tanstack/react-router";
import {
  ExternalLinkIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  LockOpenIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { ListRow, Tag } from "@/web/components/layout/layout";
import { Button } from "@/web/components/ui/button";

import { type DomainItem, dnsRecordId, domainUrl } from "./domains";
import { UptimeLine } from "./uptime/uptime-line";
import type { DomainUptime } from "./uptime/uptime-state";

/** The project's domains, the first one marked as principal; a hint row when there are none. */
export function DomainRows({
  projectId,
  domains,
  uptime,
  canEdit,
  onRemove,
  setupShown = false,
}: {
  readonly projectId: string;
  readonly domains: readonly DomainItem[];
  /** Availability of each hostname. */
  readonly uptime: ReadonlyMap<string, DomainUptime>;
  readonly canEdit: boolean;
  readonly onRemove: (domainId: string) => void;
  readonly setupShown?: boolean;
}) {
  if (domains.length === 0) {
    if (setupShown) {
      return null;
    }

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
    <ListRow key={domain.hostname} className="flex-wrap">
      <div className="min-w-0 basis-full space-y-1.5 sm:flex-1">
        {setupShown && index === 0 ? (
          <span className="font-mono text-sm font-medium break-all">{domain.hostname}</span>
        ) : (
          <DomainLink domain={domain} />
        )}
        <DomainTags domain={domain} principal={index === 0} />
        <DomainAvailability
          uptime={uptime.get(domain.hostname)}
          projectId={projectId}
          linkDns={setupShown === false || index !== 0}
        />
      </div>
      {canEdit && domain.id != null ? (
        <RemoveDomainButton domainId={domain.id} hostname={domain.hostname} onRemove={onRemove} />
      ) : null}
    </ListRow>
  ));
}

function DomainAvailability({
  uptime,
  projectId,
  linkDns,
}: {
  readonly uptime: DomainUptime | undefined;
  readonly projectId: string;
  readonly linkDns: boolean;
}) {
  if (uptime == null) {
    return null;
  }

  return (
    <>
      <UptimeLine uptime={uptime} />
      {linkDns && uptime.lastReason === "dns" ? (
        <Button asChild variant="outline" size="sm" className="min-h-11">
          <Link
            to="/projects/$projectId/dns"
            params={{ projectId }}
            hash={dnsRecordId(uptime.hostname)}
          >
            Ver registro DNS<span className="sr-only"> ({uptime.hostname})</span>
          </Link>
        </Button>
      ) : null}
    </>
  );
}

function DomainLink({ domain }: { readonly domain: DomainItem }) {
  return (
    <a
      href={domainUrl(domain)}
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
  );
}

function DomainTags({
  domain,
  principal,
}: {
  readonly domain: DomainItem;
  readonly principal: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {principal ? <Tag icon={StarIcon}>Principal</Tag> : null}
      <Tag icon={domain.httpsEnabled ? LockIcon : LockOpenIcon}>
        {domain.httpsEnabled ? "HTTPS" : "Somente HTTP"}
      </Tag>
      {domain.automatic ? <Tag icon={LinkIcon}>Automático</Tag> : null}
    </div>
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
        <Button variant="ghost" size="sm" aria-label={`Remover domínio ${hostname}`}>
          <Trash2Icon aria-hidden />
          Remover domínio
        </Button>
      }
      title={`Remover ${hostname}?`}
      description="O endereço deixa de ser roteado para a aplicação quando o contêiner for recriado. Registros DNS externos não são apagados."
      confirmLabel="Remover domínio do projeto"
      destructive
      onConfirm={() => onRemove(domainId)}
    />
  );
}
