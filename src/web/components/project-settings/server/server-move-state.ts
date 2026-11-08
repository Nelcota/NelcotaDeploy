import type { ServerView } from "@/web/admin";

export type ServerMoveOption = Pick<ServerView, "id" | "name" | "status">;

export type ServerMoveChoice = {
  readonly projectId: string;
  readonly sourceServerId: string;
  readonly targetId: string | null;
};

/** Suggests the only ready alternative, while respecting explicit choices and their source. */
export function serverMoveTarget(input: {
  readonly projectId: string;
  readonly sourceServerId: string;
  readonly choice: ServerMoveChoice | null;
  readonly servers: readonly ServerMoveOption[];
}): { readonly server: ServerMoveOption | null; readonly automatic: boolean } {
  const alternatives = input.servers.filter((server) => server.id !== input.sourceServerId);
  if (input.choice != null) {
    if (
      input.choice.projectId !== input.projectId ||
      input.choice.sourceServerId !== input.sourceServerId
    ) {
      return { server: null, automatic: false };
    }
    return {
      server: alternatives.find((server) => server.id === input.choice?.targetId) ?? null,
      automatic: false,
    };
  }
  const ready = alternatives.filter((server) => server.status === "ready");
  return ready.length === 1
    ? { server: ready.at(0) ?? null, automatic: true }
    : { server: null, automatic: false };
}

/** Explains a known blocker before asking the user to confirm an impossible move. */
export function serverMoveBlocker(status: {
  readonly volumeCount: number;
  readonly databaseCount: number;
  readonly currentDeploymentId: string | null;
  readonly deploymentsApproved: boolean;
  readonly activeDeployment: { readonly id: string } | null;
}): "storage" | "deployment" | "approval" | null {
  if (status.volumeCount > 0 || status.databaseCount > 0) {
    return "storage";
  }
  if (status.activeDeployment != null) {
    return "deployment";
  }
  if (status.currentDeploymentId != null && status.deploymentsApproved === false) {
    return "approval";
  }
  return null;
}
