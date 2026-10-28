import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { formatDateTime } from "@/shared/format";
import { LogViewer } from "@/web/components/log-viewer";
import { projectQueryOptions } from "@/web/components/project-query";
import { Label } from "@/web/components/ui/label";
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

  const url =
    selected === ALL_DEPLOYMENTS
      ? `/api/projects/${projectId}/runtime-logs`
      : `/api/projects/${projectId}/runtime-logs?deploymentId=${encodeURIComponent(selected)}`;

  return (
    <section aria-label="Logs de execução" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Saída stdout e stderr dos contêineres do projeto, atualizada em tempo real.</p>
          <p>
            As linhas aparecem quando o worker detecta o contêiner em execução. Apenas as linhas
            mais recentes de cada projeto são mantidas; valores de secrets são ocultados.
          </p>
        </div>
        <div className="w-full space-y-2 sm:w-72">
          <Label htmlFor="log-deployment">Deploy</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger id="log-deployment" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DEPLOYMENTS}>Todos os deploys</SelectItem>
              {(deployments.data ?? []).map((deployment) => (
                <SelectItem key={deployment.id} value={deployment.id}>
                  {deployment.id === currentDeploymentId ? "Atual · " : ""}
                  {deployment.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—"} ·{" "}
                  {formatDateTime(deployment.createdAt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <LogViewer
        url={url}
        emptyMessage={
          currentDeploymentId == null
            ? "O projeto ainda não tem um contêiner implantado."
            : "Aguardando linhas do contêiner…"
        }
      />
    </section>
  );
}
