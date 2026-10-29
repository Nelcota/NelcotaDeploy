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

import { type DomainItem, domainUrl } from "./domains";

/** The project's domains, the first one marked as principal; a hint row when there are none. */
export function DomainRows({
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
        <DomainLink domain={domain} />
        <DomainTags domain={domain} principal={index === 0} />
      </div>
      {canEdit && domain.id != null ? (
        <RemoveDomainButton domainId={domain.id} hostname={domain.hostname} onRemove={onRemove} />
      ) : null}
    </ListRow>
  ));
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
