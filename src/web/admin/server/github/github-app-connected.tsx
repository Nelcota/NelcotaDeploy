import { ExternalLinkIcon, UnplugIcon } from "lucide-react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { StatusPill } from "@/web/components/layout/status-badge";
import { useAction } from "@/web/components/layout/use-action";
import { Button } from "@/web/components/ui/button";
import { disconnectGitHubAppFn } from "@/web/functions/admin/github.functions";

import type { ServerData } from "../server-data";
import { GitHubPermissionNotice } from "./github-permission-notice";

type GitHubApp = NonNullable<ServerData["githubApp"]>;

/** The connected app, the page to pick its repositories, its disconnection and permissions. */
export function ConnectedGitHubApp({
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
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
      {canEdit ? <GitHubPermissionNotice appUrl={app.htmlUrl} /> : null}
    </div>
  );
}
