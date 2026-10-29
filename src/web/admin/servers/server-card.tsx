import { StatusPill } from "@/web/components/layout/status-badge";
import { Card } from "@/web/components/ui/card";

import { InstallCommand } from "./install-command";
import { AcceptsApplicationsSwitch, RemoveServerButton } from "./server-controls";
import { ServerFacts } from "./server-facts";
import { describeServerProblem, serverStatusPill } from "./server-status";
import { ServerUsage } from "./server-usage";
import type { ServerView } from "./use-servers";

function serverAddress(server: ServerView): string {
  if (server.kind === "local") {
    return "A VPS onde o painel roda.";
  }
  return `${server.username ?? ""}@${server.host ?? ""}:${server.port ?? ""}`;
}

function ServerHeader({
  server,
  canEdit,
}: {
  readonly server: ServerView;
  readonly canEdit: boolean;
}) {
  const status = serverStatusPill(server);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h3 className="flex flex-wrap items-center gap-2 font-semibold">
          {server.name}
          <StatusPill tone={status.tone} label={status.label} />
        </h3>
        <p className="text-sm text-muted-foreground">
          {serverAddress(server)}
          {server.dockerVersion == null ? "" : ` · Docker ${server.dockerVersion}`}
        </p>
      </div>
      {canEdit && server.kind === "ssh" ? <RemoveServerButton server={server} /> : null}
    </div>
  );
}

/** Why the server is not ready; hidden while the install command explains what to do. */
function ServerProblem({ server }: { readonly server: ServerView }) {
  if (server.status === "ready" || server.installCommand != null) {
    return null;
  }
  const problem = describeServerProblem(server.statusMessage);
  return problem == null ? null : (
    <p role="status" className="text-sm text-warning">
      {problem}
    </p>
  );
}

/** One server: state, address, usage, setup command while pending and its settings. */
export function ServerCard({
  server,
  canEdit,
}: {
  readonly server: ServerView;
  readonly canEdit: boolean;
}) {
  return (
    <Card className="gap-5 p-5">
      <ServerHeader server={server} canEdit={canEdit} />
      <ServerProblem server={server} />
      {server.installCommand != null && canEdit ? (
        <InstallCommand command={server.installCommand} />
      ) : null}
      {server.status === "ready" ? <ServerUsage host={server.hostSample} /> : null}
      {server.kind === "ssh" ? <ServerFacts server={server} /> : null}
      <AcceptsApplicationsSwitch server={server} canEdit={canEdit} />
    </Card>
  );
}
