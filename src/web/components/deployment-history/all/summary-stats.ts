import { CircleCheckIcon, CircleXIcon, RocketIcon, TimerIcon } from "lucide-react";

import { formatDuration, formatPercent } from "@/shared/format";
import type { Stat } from "@/web/components/layout/layout";
import type { getDeploymentStatsFn } from "@/web/functions/deployments.functions";

type DeploymentStatsData = Awaited<ReturnType<typeof getDeploymentStatsFn>>;

/**
 * Builds the summary tiles of the deploys page: count, success rate, failures and duration.
 *
 * @param data - Deploy statistics of the period.
 * @returns The four stats in display order.
 */
export function summaryStats(
  data: Pick<
    DeploymentStatsData,
    "total" | "succeeded" | "failed" | "successRatePercent" | "averageDurationInMs"
  >,
): Stat[] {
  return [
    { label: "Deploys", icon: RocketIcon, value: data.total },
    {
      label: "Taxa de sucesso",
      icon: CircleCheckIcon,
      value: data.successRatePercent == null ? "—" : formatPercent(data.successRatePercent),
      detail: `${data.succeeded} concluídos`,
      tone: "success",
    },
    {
      label: "Falharam",
      icon: CircleXIcon,
      value: data.failed,
      tone: data.failed > 0 ? "danger" : "default",
    },
    {
      label: "Duração média",
      icon: TimerIcon,
      value: formatDuration(data.averageDurationInMs),
      detail: "dos concluídos",
    },
  ];
}
