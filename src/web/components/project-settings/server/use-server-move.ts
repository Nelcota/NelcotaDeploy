import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useServers } from "@/web/admin";
import { useAction } from "@/web/components/layout/use-action";
import {
  getProjectMoveStatusFn,
  moveProjectFn,
} from "@/web/functions/servers/project-move.functions";

import { type ServerMoveChoice, serverMoveBlocker, serverMoveTarget } from "./server-move-state";

type MoveInput = Parameters<typeof moveProjectFn>[0]["data"];
const PREREQUISITES_REFRESH_INTERVAL_IN_MS = 5000;

/** Read-only discovery, source-scoped destination choices and frozen move confirmation. */
export function useServerMove(input: {
  readonly projectId: string;
  readonly serverId: string;
  readonly deployed: boolean;
}) {
  const { projectId } = input;
  const queryClient = useQueryClient();
  const servers = useServers();
  const status = useQuery({
    queryKey: ["project-move", projectId],
    queryFn: () => getProjectMoveStatusFn({ data: { projectId } }),
    refetchInterval: PREREQUISITES_REFRESH_INTERVAL_IN_MS,
  });
  const sourceId = status.data?.serverId ?? input.serverId;
  const deployed = status.data == null ? input.deployed : status.data.currentDeploymentId != null;
  const scope = `${projectId}:${sourceId}`;
  const [previousScope, setPreviousScope] = useState(scope);
  const [choice, setChoice] = useState<ServerMoveChoice | null>(null);
  const [review, setReview] = useState<{
    readonly request: MoveInput;
    readonly sourceName: string;
    readonly targetName: string;
    readonly deployed: boolean;
  } | null>(null);
  if (scope !== previousScope) {
    setPreviousScope(scope);
    setChoice({ projectId, sourceServerId: sourceId, targetId: null });
    setReview(null);
  }
  const invalidate = [
    ["project", projectId],
    ["project-move", projectId],
    ["projects"],
    ["servers"],
    ["server-address", projectId],
    ["deployments"],
  ] as const;
  const move = useAction({
    action: async (request: MoveInput) => {
      try {
        return await moveProjectFn({ data: request });
      } catch (error) {
        await Promise.all(
          invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        );
        throw error;
      }
    },
    successMessage: (result) => {
      if (result.changed === false) {
        return "O projeto já está neste servidor.";
      }
      return result.deploymentId == null
        ? "Servidor alterado. O próximo deploy roda nele."
        : "Mudança iniciada: o deploy no novo servidor está na fila.";
    },
    invalidate,
    onSuccess: (result) =>
      setChoice({ projectId, sourceServerId: result.serverId, targetId: null }),
  });
  const list = servers.data?.servers ?? [];
  const sourceName = list.find((server) => server.id === sourceId)?.name ?? "Servidor atual";
  const target = serverMoveTarget({ projectId, sourceServerId: sourceId, choice, servers: list });
  const blocker = status.data == null ? null : serverMoveBlocker(status.data);
  const unavailable =
    status.data == null || status.isError || servers.data == null || servers.isError;
  const canMove =
    unavailable === false &&
    blocker == null &&
    target.server?.status === "ready" &&
    move.isPending === false;
  const beginReview = () => {
    if (canMove === false) {
      return;
    }
    setReview({
      request: {
        projectId,
        serverId: target.server.id,
        expectedServerId: status.data.serverId,
        expectedDeploymentId: status.data.currentDeploymentId,
        expectedUpdatedAt: status.data.updatedAt,
      },
      sourceName,
      targetName: target.server.name,
      deployed,
    });
  };
  return {
    servers,
    status,
    sourceId,
    sourceName,
    target,
    blocker,
    unavailable,
    canMove,
    move,
    review,
    beginReview,
    choose: (targetId: string) => setChoice({ projectId, sourceServerId: sourceId, targetId }),
    closeReview: () => setReview(null),
  };
}
