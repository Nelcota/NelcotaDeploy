import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  LoaderCircleIcon,
  RocketIcon,
  ServerIcon,
} from "lucide-react";

import { CardTitleRow, StatusTile } from "@/web/components/layout/layout";
import { describeSystemStatus, SYSTEM_STATUS_DOTS } from "@/web/components/shell/system-status";
import { Card } from "@/web/components/ui/card";
import { cn } from "@/web/components/ui/class-names";
import { Skeleton } from "@/web/components/ui/skeleton";
import { getSidebarStatusFn } from "@/web/functions/dashboard.functions";

import { type DashboardSummary, REFRESH_INTERVAL_IN_MS } from "./dashboard";

function useSidebarStatus() {
  return useQuery({
    queryKey: ["sidebar-status"],
    queryFn: () => getSidebarStatusFn(),
    refetchInterval: REFRESH_INTERVAL_IN_MS,
  });
}

function WorkerPill() {
  const status = useSidebarStatus();
  // Deploys in progress already have their own tile here, so the pill only tells the health.
  const { label, tone } = describeSystemStatus({
    pending: status.isPending,
    failed: status.isError,
    worker: status.data?.worker ?? null,
    activeDeployments: 0,
  });
  return (
    <Link
      to="/settings"
      search={{ tab: "server" }}
      className="flex h-9 items-center gap-2 rounded-full px-3.5 text-sm ring-1 ring-border transition-colors hover:bg-well focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ServerIcon aria-hidden className="size-4 text-muted-foreground" />
      {label}
      <span aria-hidden className={cn("size-2 rounded-full", SYSTEM_STATUS_DOTS[tone])} />
    </Link>
  );
}

/** Icon color of a tile: its tone when the count is above zero, neutral otherwise. */
function toneWhenPositive(count: number, className: string): string {
  return count > 0 ? className : "";
}

/** Top card: how many applications there are, and the state of each group at a glance. */
export function OverviewCard({ data }: { readonly data: DashboardSummary | null }) {
  if (data == null) {
    return <Skeleton className="h-52 rounded-2xl" />;
  }
  return (
    <Card className="gap-4 p-5">
      <div className="flex min-w-0 flex-col gap-4">
        <CardTitleRow icon={ActivityIcon} title="Status das aplicações" count={data.projectCount}>
          <WorkerPill />
        </CardTitleRow>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <ApplicationTiles data={data} />
          <DeploymentTiles data={data} />
        </dl>
      </div>
    </Card>
  );
}

function ApplicationTiles({ data }: { readonly data: DashboardSummary }) {
  // Same rule as the "Precisam de atenção" filter: down, or running but failing its check.
  const attention = data.offlineCount + data.unhealthyCount;
  return (
    <>
      <StatusTile
        value={data.onlineCount}
        label="Online"
        icon={CircleCheckIcon}
        iconClassName={toneWhenPositive(data.onlineCount, "text-success")}
      />
      <StatusTile
        value={attention}
        label="Precisam de atenção"
        icon={CircleAlertIcon}
        iconClassName={toneWhenPositive(attention, "text-warning")}
      />
      <StatusTile value={data.neverDeployedCount} label="Sem deploy" icon={CircleDashedIcon} />
    </>
  );
}

function DeploymentTiles({ data }: { readonly data: DashboardSummary }) {
  const status = useSidebarStatus();
  const active = status.data?.activeDeployments ?? 0;
  const failures = data.failuresLastDayCount;
  return (
    <>
      <StatusTile
        value={data.deploymentsLastDayCount}
        label={"Deploys em 24 h"}
        icon={RocketIcon}
      />
      <StatusTile
        value={active}
        label="Em andamento"
        icon={LoaderCircleIcon}
        iconClassName={toneWhenPositive(active, "text-brand")}
        tone={active > 0 ? "progress" : "default"}
      />
      <StatusTile
        value={failures}
        label={"Falhas em 24 h"}
        icon={CircleXIcon}
        iconClassName={toneWhenPositive(failures, "text-destructive")}
        tone={failures > 0 ? "danger" : "default"}
      />
    </>
  );
}
