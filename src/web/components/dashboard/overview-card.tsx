import {
  ActivityIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  LoaderCircleIcon,
  RocketIcon,
} from "lucide-react";

import { CardTitleRow, StatusTile } from "@/web/components/layout/layout";
import { useSystemStatus } from "@/web/components/shell/use-shell-queries";
import { Card } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";

import type { DashboardSummary } from "./dashboard";

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
        {/* The system health is the status button in the top bar, on every page. */}
        <CardTitleRow icon={ActivityIcon} title="Status das aplicações" count={data.projectCount} />
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
  const status = useSystemStatus();
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
