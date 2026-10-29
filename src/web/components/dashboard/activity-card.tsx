import { Link } from "@tanstack/react-router";
import { HistoryIcon } from "lucide-react";
import { useState } from "react";

import { CardTitleRow, TEXT_LINK } from "@/web/components/layout/layout";
import { SegmentedControl } from "@/web/components/layout/overview";
import { Card } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";

import { ActivityList } from "./activity-list";
import type { DashboardSummary } from "./dashboard";

type ActivityView = "recent" | "failed";

function failuresLabel(data: DashboardSummary | null): string {
  if (data == null) {
    return "Falhas em 24 h";
  }
  return `Falhas em 24 h (${data.failuresLastDayCount})`;
}

/** Latest deploys of every project, or only the failures of the last day. */
export function ActivityCard({ data }: { readonly data: DashboardSummary | null }) {
  const [view, setView] = useState<ActivityView>("recent");
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={HistoryIcon} title="Atividade">
        <Link to="/deployments" className={TEXT_LINK}>
          Ver todos
        </Link>
      </CardTitleRow>
      <SegmentedControl
        label="Atividade"
        options={[
          { value: "recent", label: "Recentes" },
          { value: "failed", label: failuresLabel(data) },
        ]}
        value={view}
        onChange={setView}
      />
      {data == null ? (
        <Skeleton className="h-60 rounded-lg" />
      ) : (
        <ActivityList
          deployments={view === "recent" ? data.recentDeployments : data.recentFailures}
          view={view}
        />
      )}
    </Card>
  );
}
