import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ContainerIcon, ScrollTextIcon } from "lucide-react";
import { useState } from "react";

import { formatRelativeTime } from "@/shared/format";
import { LogViewer } from "@/web/components/log-viewer";
import { TabHeader } from "@/web/components/project-header";
import { projectQueryOptions } from "@/web/components/project-query";
import { EmptyState } from "@/web/components/states";
import { Button } from "@/web/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { listDeploymentsFn } from "@/web/functions/deployments.functions";

const RECENT_DEPLOYMENTS = 10;
const ALL_DEPLOYMENTS = "all";
const SHORT_SHA_LENGTH = 7;

export const Route = createFileRoute("/_app/projects/$projectId/logs")({
  head: () => ({ meta: [{ title: "Logs · Nelcota Deploy" }] }),
  component: RuntimeLogsPage,
});

function RuntimeLogsPage() {
  const { projectId } = Route.useParams();
  const project = useQuery(projectQueryOptions(projectId));
  const deployments = useQuery({
    queryKey: ["deployments", projectId, "succeeded"],
    queryFn: () =>
      listDeploymentsFn({ data: { projectId, status: "succeeded", limit: RECENT_DEPLOYMENTS } }),
  });
  const [selected, setSelected] = useState(ALL_DEPLOYMENTS);
  const currentDeploymentId = project.data?.project.currentDeploymentId ?? null;
  const neverDeployed = project.data != null && currentDeploymentId == null;
  const now = new Date();

  const url =
    selected === ALL_DEPLOYMENTS
      ? `/api/projects/${projectId}/runtime-logs`
      : `/api/projects/${projectId}/runtime-logs?deploymentId=${encodeURIComponent(selected)}`;

  return (
    <section aria-label="Logs de execução" className="space-y-6">
      <TabHeader
        icon={ScrollTextIcon}
        title="Logs"
        description="Saída dos contêineres em tempo real. Valores de secrets são ocultados."
        actions={
          neverDeployed ? null : (
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger aria-label="Deploy" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_DEPLOYMENTS}>Todos os deploys</SelectItem>
                {(deployments.data ?? []).map((deployment) => (
                  <SelectItem key={deployment.id} value={deployment.id}>
                    <span className="font-mono">
                      {deployment.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}
                    </span>
                    <span className="text-muted-foreground">
                      {formatRelativeTime(deployment.createdAt, now)}
                    </span>
                    {deployment.id === currentDeploymentId ? (
                      <span className="rounded-full bg-secondary px-1.5 text-xs font-medium text-muted-foreground">
                        No ar
                      </span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }
      />
      {neverDeployed ? (
        <EmptyState
          icon={ContainerIcon}
          title="Nenhum contêiner implantado"
          description="Os logs aparecem aqui assim que o primeiro deploy colocar a aplicação no ar."
          action={
            <Button variant="outline" asChild>
              <Link to="/projects/$projectId/deployments" params={{ projectId }}>
                Ver deploys
              </Link>
            </Button>
          }
        />
      ) : (
        <LogViewer
          url={url}
          heightClass="h-[36rem]"
          emptyMessage="Aguardando linhas do contêiner…"
        />
      )}
    </section>
  );
}
