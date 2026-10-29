import { ExternalLinkIcon, GitBranchIcon, UnplugIcon } from "lucide-react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { Section } from "@/web/components/layout/layout";
import { StatusPill } from "@/web/components/layout/status-badge";
import { useAction } from "@/web/components/layout/use-action";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import { disconnectGitHubAppFn } from "@/web/functions/admin/github.functions";

import { ConnectGitHubApp } from "./github-app-connect";
import type { ServerData } from "./server-data";

type GitHubApp = NonNullable<ServerData["githubApp"]>;

/** The GitHub App that lists repositories, clones private ones and delivers pushes. */
export function GitHubAppSection({ server }: { readonly server: ServerData }) {
  const can = useCan();
  return (
    <Section icon={GitBranchIcon} title="GitHub">
      {server.githubApp == null ? (
        <ConnectGitHubApp canEdit={can("settings:write")} server={server} />
      ) : (
        <ConnectedGitHubApp app={server.githubApp} canEdit={can("settings:write")} />
      )}
    </Section>
  );
}

function ConnectedGitHubApp({
  app,
  canEdit,
}: {
  readonly app: GitHubApp;
  readonly canEdit: boolean;
}) {
  const disconnect = useAction({
    action: () => disconnectGitHubAppFn(),
    successMessage: "GitHub desconectado",
    invalidate: [["settings"], ["github-repositories"]],
  });
  return (
    <div className="flex max-w-2xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1.5">
        <StatusPill tone="success" label="Conectado" />
        <p className="text-sm">
          {app.name} <span className="text-muted-foreground">· {app.ownerLogin}</span>
        </p>
      </div>
      {canEdit ? (
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={app.installUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon aria-hidden />
              Escolher repositórios
            </a>
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" disabled={disconnect.isPending}>
                <UnplugIcon aria-hidden />
                Desconectar
              </Button>
            }
            title="Desconectar o GitHub?"
            description="O painel deixa de usar o app. Repositórios privados voltam a precisar de token. O app continua no GitHub até ser apagado lá."
            confirmLabel="Desconectar"
            destructive
            onConfirm={() => disconnect.mutate()}
          />
        </div>
      ) : null}
    </div>
  );
}
