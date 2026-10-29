import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, GlobeIcon, LockIcon, LockOpenIcon } from "lucide-react";

import { CardTitleRow, Tag, TEXT_LINK } from "@/web/components/layout/layout";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { Card } from "@/web/components/ui/card";

type Domain = ProjectDetails["domains"][number];

/** The public addresses of the project, each opening in a new tab. */
export function AddressesCard({ details }: { readonly details: ProjectDetails }) {
  const { project, domains } = details;
  return (
    <Card className="gap-3 p-5">
      <CardTitleRow icon={GlobeIcon} title="Endereços" count={domains.length}>
        <Link
          to="/projects/$projectId/domains"
          params={{ projectId: project.id }}
          className={TEXT_LINK}
        >
          Gerenciar
        </Link>
      </CardTitleRow>
      {domains.length === 0 ? (
        <p className="py-2.5 text-sm text-muted-foreground">
          Nenhum domínio.{" "}
          <Link
            to="/projects/$projectId/domains"
            params={{ projectId: project.id }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Adicionar domínio
          </Link>
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {domains.map((domain) => (
            <AddressItem key={domain.hostname} domain={domain} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AddressItem({ domain }: { readonly domain: Domain }) {
  const url = `${domain.httpsEnabled ? "https" : "http"}://${domain.hostname}`;
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="group flex min-w-0 items-center gap-2 rounded-sm font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        title={domain.hostname}
      >
        <span className="truncate group-hover:underline">{domain.hostname}</span>
        <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0 text-faint" />
        <span className="sr-only"> (abre em nova aba)</span>
      </a>
      <Tag icon={domain.httpsEnabled ? LockIcon : LockOpenIcon}>
        {domain.httpsEnabled ? "HTTPS" : "HTTP"}
      </Tag>
    </li>
  );
}
