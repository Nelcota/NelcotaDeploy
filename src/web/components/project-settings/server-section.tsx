import { ArrowRightLeftIcon, ServerIcon } from "lucide-react";
import { useState } from "react";

import { type ServerView, useServers } from "@/web/admin/servers/use-servers";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { useAction } from "@/web/components/layout/use-action";
import { Button } from "@/web/components/ui/button";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { moveProjectFn } from "@/web/functions/servers/project-move.functions";

import { SettingsSection } from "./settings-section";

function useMoveProject(projectId: string) {
  return useAction({
    action: (serverId: string) => moveProjectFn({ data: { projectId, serverId } }),
    successMessage: (result) =>
      result.deploymentId == null
        ? "Servidor alterado. O próximo deploy roda nele."
        : "Mudança iniciada: o deploy no novo servidor está na fila.",
    invalidate: [["project", projectId], ["servers"]],
  });
}

type ServerOption = Pick<ServerView, "id" | "name" | "status">;

function ServerSelect({
  servers,
  value,
  onChange,
}: {
  readonly servers: readonly ServerOption[];
  readonly value: string;
  readonly onChange: (serverId: string) => void;
}) {
  return (
    <div className="flex-1 space-y-2">
      <Label htmlFor="project-server">Servidor</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="project-server" className="w-full">
          <SelectValue placeholder="Carregando servidores…" />
        </SelectTrigger>
        <SelectContent>
          {servers.map((server) => (
            <SelectItem key={server.id} value={server.id} disabled={server.status !== "ready"}>
              {server.status === "ready" ? server.name : `${server.name} (indisponível)`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Shows where the project runs and moves it to another server. */
export function ServerSection({
  projectId,
  serverId,
  deployed,
}: {
  readonly projectId: string;
  readonly serverId: string;
  readonly deployed: boolean;
}) {
  const servers = useServers().data?.servers ?? [];
  const [target, setTarget] = useState(serverId);
  const move = useMoveProject(projectId);
  const targetName = servers.find((server) => server.id === target)?.name ?? "";
  return (
    <SettingsSection
      icon={ServerIcon}
      title="Servidor"
      description="A VPS onde o projeto roda. Ao mover, o novo contêiner sobe e passa no health check antes de o antigo ser removido."
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <ServerSelect servers={servers} value={target} onChange={setTarget} />
        <ConfirmDialog
          trigger={
            <Button disabled={target === serverId || move.isPending}>
              <ArrowRightLeftIcon aria-hidden />
              Mover
            </Button>
          }
          title={`Mover o projeto para ${targetName}?`}
          description={
            deployed
              ? "O build roda de novo no servidor escolhido. Depois, aponte o DNS dos domínios para o IP dele: o contêiner antigo segue no ar até o DNS mudar (ou por até 24 horas)."
              : "O próximo deploy do projeto vai rodar no servidor escolhido."
          }
          confirmLabel="Mover"
          onConfirm={() => move.mutate(target)}
        />
      </div>
    </SettingsSection>
  );
}
