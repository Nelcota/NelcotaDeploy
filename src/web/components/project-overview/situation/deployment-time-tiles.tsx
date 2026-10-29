import { ClockIcon, RocketIcon } from "lucide-react";

import { formatRelativeTime, formatShortTime } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";
import { DEPLOYMENT_STATUS_LABELS } from "@/web/components/layout/labels";
import { StatusTile } from "@/web/components/layout/layout";
import { Skeleton } from "@/web/components/ui/skeleton";

import type { RecentDeployment } from "../use-recent-deployments";

/** Status and age of the newest deployment, red when it failed. */
export function LatestDeploymentTile({
  latest,
  loading,
}: {
  readonly latest: RecentDeployment | null;
  readonly loading: boolean;
}) {
  const now = useNow();
  const failed = latest?.status === "failed";
  const commonProps = {
    label: "Último deploy",
    icon: RocketIcon,
    iconClassName: failed ? "text-destructive" : "",
    tone: failed ? "danger" : "default",
  } as const;
  if (loading) {
    return <StatusTile {...commonProps} value={<Skeleton className="h-6 w-20" />} />;
  }
  if (latest == null) {
    return <StatusTile {...commonProps} value="—" detail="nenhum ainda" />;
  }
  return (
    <StatusTile
      {...commonProps}
      value={DEPLOYMENT_STATUS_LABELS[latest.status]}
      detail={formatRelativeTime(latest.createdAt, now)}
    />
  );
}

/** When the running container started. */
export function UptimeTile({ startedAt }: { readonly startedAt: string | null }) {
  const now = useNow();
  return (
    <StatusTile
      value={startedAt == null ? "—" : formatShortTime(startedAt)}
      detail={startedAt == null ? undefined : formatRelativeTime(startedAt, now)}
      label="No ar desde"
      icon={ClockIcon}
      className="col-span-2 md:col-span-1"
    />
  );
}
