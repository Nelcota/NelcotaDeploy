import { useQuery } from "@tanstack/react-query";
import { GitCommitHorizontalIcon } from "lucide-react";

import { StatusTile } from "@/web/components/layout/layout";
import { Skeleton } from "@/web/components/ui/skeleton";
import { getDeploymentFn } from "@/web/functions/deployments.functions";

const SHORT_SHA_LENGTH = 7;

/** Shows the commit the running deployment was built from. */
export function CommitTile({
  currentDeploymentId,
}: {
  readonly currentDeploymentId: string | null;
}) {
  const current = useQuery({
    queryKey: ["deployment", currentDeploymentId],
    queryFn: () => getDeploymentFn({ data: { deploymentId: currentDeploymentId ?? "" } }),
    enabled: currentDeploymentId != null,
  });
  const sha = current.data?.commitSha ?? null;
  return (
    <StatusTile
      value={
        current.isLoading ? (
          <Skeleton className="h-6 w-20" />
        ) : (
          <span className="font-mono">{sha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}</span>
        )
      }
      detail={current.data?.commitMessage ?? undefined}
      label="Commit no ar"
      icon={GitCommitHorizontalIcon}
    />
  );
}
