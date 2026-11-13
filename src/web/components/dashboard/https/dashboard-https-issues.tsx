import { Link } from "@tanstack/react-router";

import { HttpsDiagnosticLink } from "@/web/components/domains/dns/https-diagnostic-link";
import { Card } from "@/web/components/ui/card";

import type { DashboardSummary } from "../dashboard";

/** Lists affected domains and links to the complete project filter. */
export function DashboardHttpsIssues({ data }: { readonly data: DashboardSummary }) {
  return (
    <Card className="min-w-0 gap-2 p-3">
      <h2>
        <Link
          to="/projects"
          search={{ status: "https" }}
          className="flex min-h-12 items-center justify-between gap-2 rounded-lg px-3 py-2 text-base font-semibold text-brand underline-offset-4 hover:bg-well hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Domínios com problema no HTTPS
          <span className="rounded-full bg-well px-2 py-0.5 text-sm text-foreground">
            {data.httpsIssueCount}
            <span className="sr-only"> domínios</span>
          </span>
        </Link>
      </h2>
      <ul role="list" className="grid gap-1 sm:grid-cols-2">
        {data.httpsIssues.map((issue) => (
          <li key={`${issue.projectId}:${issue.hostname}`} className="min-w-0">
            <HttpsDiagnosticLink
              projectId={issue.projectId}
              hostname={issue.hostname}
              projectName={issue.projectName}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
