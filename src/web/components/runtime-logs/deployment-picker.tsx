import { useQuery } from "@tanstack/react-query";

import { formatRelativeTime } from "@/shared/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { listDeploymentsFn } from "@/web/functions/deployments.functions";

import { ALL_DEPLOYMENTS, shortShaOf } from "./runtime-logs";

const RECENT_DEPLOYMENTS = 10;

/** Which deploy the console streams: the live one by default, a recent one, or all of them. */
export function DeploymentPicker({
  projectId,
  currentDeploymentId,
  selected,
  now,
  onChange,
}: {
  readonly projectId: string;
  readonly currentDeploymentId: string;
  readonly selected: string;
  readonly now: Date;
  readonly onChange: (deploymentId: string) => void;
}) {
  const query = useQuery({
    queryKey: ["deployments", projectId, "succeeded"],
    queryFn: () =>
      listDeploymentsFn({ data: { projectId, status: "succeeded", limit: RECENT_DEPLOYMENTS } }),
  });
  const deployments = query.data ?? [];
  const liveListed = deployments.some((deployment) => deployment.id === currentDeploymentId);
  return (
    <Select value={selected} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Deploy exibido"
        className="h-9 w-full border-0 bg-white/5 text-sm text-console-foreground ring-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {liveListed ? null : <SelectItem value={currentDeploymentId}>Deploy no ar</SelectItem>}
        {deployments.map((deployment) => (
          <SelectItem key={deployment.id} value={deployment.id}>
            <span className="font-mono">{shortShaOf(deployment)}</span>
            <span className="text-muted-foreground">
              {deployment.id === currentDeploymentId
                ? "no ar"
                : formatRelativeTime(deployment.createdAt, now)}
            </span>
          </SelectItem>
        ))}
        <SelectItem value={ALL_DEPLOYMENTS}>Todos os deploys recentes</SelectItem>
      </SelectContent>
    </Select>
  );
}
