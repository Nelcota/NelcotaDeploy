import { Link } from "@tanstack/react-router";
import { ScrollTextIcon } from "lucide-react";

import { formatDateTime } from "@/shared/format";
import { OpenAppButton } from "@/web/components/projects/project-actions";
import { Button } from "@/web/components/ui/button";

import { certificateHistoryId, domainUrl } from "../domains";

/** Presents a verified domain recovery with its two follow-up actions. */
export function HttpsRecoveryCard({
  projectId,
  hostname,
  recoveredAt,
  projectName,
}: {
  readonly projectId: string;
  readonly hostname: string;
  readonly recoveredAt: string;
  readonly projectName?: string;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col gap-3 rounded-lg border border-success/25 bg-success/8 p-3">
      <div className="space-y-1">
        <p className="font-mono text-sm font-semibold wrap-anywhere">{hostname}</p>
        {projectName == null ? null : (
          <p className="text-sm text-muted-foreground wrap-anywhere">{projectName}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Recuperação verificada em{" "}
          <time dateTime={recoveredAt}>{formatDateTime(recoveredAt)}</time>
        </p>
      </div>
      <div className="mt-auto grid gap-2 sm:flex sm:flex-wrap">
        <OpenAppButton url={domainUrl({ hostname, httpsEnabled: true })} prominent />
        <Button variant="outline" className="min-h-11" asChild>
          <Link
            to="/projects/$projectId/dns"
            params={{ projectId }}
            hash={certificateHistoryId(hostname)}
          >
            <ScrollTextIcon aria-hidden />
            Ver histórico<span className="sr-only"> de {hostname}</span>
          </Link>
        </Button>
      </div>
    </div>
  );
}
