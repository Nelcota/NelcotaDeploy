import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";

import { dnsRecordId } from "../domains";

/** Opens the diagnostic for the affected hostname, including secondary domains. */
export function HttpsDiagnosticLink({
  projectId,
  hostname,
  projectName,
}: {
  readonly projectId: string;
  readonly hostname: string;
  readonly projectName?: string;
}) {
  return (
    <Link
      to="/projects/$projectId/dns"
      params={{ projectId }}
      hash={dnsRecordId(hostname)}
      className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:bg-well focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="min-w-0 wrap-anywhere">
        <span className="block font-medium">{hostname}</span>
        <span className="block text-xs text-muted-foreground">
          {projectName == null ? "Ver diagnóstico HTTPS" : `${projectName} · Ver diagnóstico HTTPS`}
        </span>
      </span>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
