import { Link } from "@tanstack/react-router";
import { CircleXIcon, LoaderCircleIcon, RocketIcon } from "lucide-react";

import { CardTitleRow, StatusTile } from "@/web/components/layout/layout";
import { STATUS_FILTERS, type StatusFilter } from "@/web/components/project-list/project-list";
import { useSystemStatus } from "@/web/components/shell/use-shell-queries";
import { Card } from "@/web/components/ui/card";
import { cn } from "@/web/components/ui/class-names";
import { Skeleton } from "@/web/components/ui/skeleton";

import type { DashboardSummary } from "./dashboard";

/** Icon color of a tile: its tone when the count is above zero, neutral otherwise. */
function toneWhenPositive(count: number, className: string): string {
  return count > 0 ? className : "";
}

/** Application health and direct links to the matching project lists. */
export function OverviewCard({ data }: { readonly data: DashboardSummary | null }) {
  if (data == null) {
    return <Skeleton className="h-40 rounded-xl" />;
  }

  return (
    <section aria-label="Status das aplicações">
      <ul className="grid gap-3 sm:grid-cols-3">
        <ApplicationTile
          value={data.onlineCount}
          status="online"
          icon="solar-[check-circle-bold-duotone]"
          tone="text-success"
        />
        <ApplicationTile
          value={data.offlineCount + data.unhealthyCount}
          status="offline"
          icon="solar-[danger-circle-bold-duotone]"
          tone="text-warning"
        />
        <ApplicationTile
          value={data.neverDeployedCount}
          status="never"
          icon="solar-[minus-circle-bold-duotone]"
        />
      </ul>
    </section>
  );
}

function ApplicationTile({
  value,
  status,
  icon,
  tone = "",
}: {
  readonly value: number;
  readonly status: StatusFilter;
  readonly icon: string;
  readonly tone?: string;
}) {
  return (
    <li className="min-w-0">
      <Link
        to="/projects"
        search={{ status }}
        className="flex h-full min-h-20 items-center gap-3 rounded-xl border border-border bg-surface-raised p-3.5 transition-colors hover:bg-well focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:p-4"
      >
        <span
          aria-hidden
          className={cn(
            "size-5 shrink-0 text-muted-foreground",
            icon,
            toneWhenPositive(value, tone),
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{STATUS_FILTERS[status]}</span>
          <span className="block text-2xl leading-tight font-semibold tabular-nums">{value}</span>
        </span>
        <span aria-hidden className="solar-[alt-arrow-right-linear] size-4 shrink-0 text-faint" />
      </Link>
    </li>
  );
}

function DeploymentTiles({ data }: { readonly data: DashboardSummary }) {
  const status = useSystemStatus();
  const active = status.data?.activeDeployments ?? 0;
  const failures = data.failuresLastDayCount;
  return (
    <>
      <StatusTile value={data.deploymentsLastDayCount} label="Deploys 24 h" icon={RocketIcon} />
      <StatusTile
        value={active}
        label="Em andamento"
        icon={LoaderCircleIcon}
        iconClassName={toneWhenPositive(active, "text-brand")}
        tone={active > 0 ? "progress" : "default"}
      />
      <StatusTile
        value={failures}
        label="Falhas 24 h"
        icon={CircleXIcon}
        iconClassName={toneWhenPositive(failures, "text-destructive")}
        tone={failures > 0 ? "danger" : "default"}
      />
    </>
  );
}

/** Deployment activity belongs to its own page rather than the application status page. */
export function DeploymentActivitySummary({ data }: { readonly data: DashboardSummary | null }) {
  if (data == null) {
    return <Skeleton className="h-44 rounded-2xl" />;
  }
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={RocketIcon} title="Atividade de deploys em 24 horas" />
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <DeploymentTiles data={data} />
      </dl>
    </Card>
  );
}
