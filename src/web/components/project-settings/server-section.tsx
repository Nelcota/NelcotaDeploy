import { Link } from "@tanstack/react-router";
import { ArrowRightLeftIcon, LoaderCircleIcon, ServerIcon } from "lucide-react";

import { pluralize } from "@/shared/format";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { toUserMessage } from "@/web/components/layout/error-message";
import { Button } from "@/web/components/ui/button";

import { ServerTargetSelect } from "./server/server-target-select";
import { useServerMove } from "./server/use-server-move";
import { SettingsSection } from "./settings-section";

/** Shows the current server, discovers move blockers and reviews a fixed destination. */
export function ServerSection(props: {
  readonly projectId: string;
  readonly serverId: string;
  readonly deployed: boolean;
}) {
  const state = useServerMove(props);
  const active = state.status.data?.activeDeployment;
  return (
    <SettingsSection id="settings-server" icon={ServerIcon} title="Servidor atual e migração">
      <div className="space-y-4">
        <p className="text-sm break-all">
          Servidor configurado: <strong>{state.sourceName}</strong>
        </p>
        <ServerMoveNotice state={state} projectId={props.projectId} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <ServerTargetSelect
            servers={state.servers.data?.servers ?? []}
            sourceId={state.sourceId}
            value={state.target.server?.id ?? ""}
            disabled={state.unavailable || state.blocker != null || state.move.isPending}
            onChange={state.choose}
          />
          <Button disabled={state.canMove === false} onClick={state.beginReview}>
            {state.move.isPending ? (
              <LoaderCircleIcon aria-hidden className="animate-spin" />
            ) : (
              <ArrowRightLeftIcon aria-hidden />
            )}
            {state.move.isPending ? "Movendo projeto…" : "Revisar troca de servidor"}
          </Button>
        </div>
        {state.target.automatic && state.canMove ? (
          <p role="status" className="text-xs text-muted-foreground">
            O único destino pronto foi preenchido automaticamente. A troca só acontece após
            confirmar.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-4 text-sm">
          <Link to="/settings/servers" className="underline underline-offset-4">
            Gerenciar servidores
          </Link>
          {active == null ? null : (
            <Link
              to="/projects/$projectId/deployments/$deploymentId"
              params={{ projectId: props.projectId, deploymentId: active.id }}
              className="underline underline-offset-4"
            >
              Acompanhar deploy
            </Link>
          )}
        </div>
        {state.move.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {toUserMessage(
              state.move.error,
              "Não foi possível mover o projeto. Confira os dados e tente novamente.",
            )}
          </p>
        ) : null}
      </div>
      {state.review == null ? null : (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (open === false) {
              state.closeReview();
            }
          }}
          title="Confirmar troca de servidor"
          description={
            <div className="space-y-2">
              <p className="break-all">
                De <strong>{state.review.sourceName}</strong> para{" "}
                <strong>{state.review.targetName}</strong>.
              </p>
              <p>
                {state.review.deployed
                  ? "Um deploy da versão atual será enfileirado no destino. Depois que ele estiver pronto, confira o DNS na página de domínios; a mudança de DNS exige uma confirmação separada."
                  : "O próximo deploy do projeto vai rodar no servidor escolhido."}
              </p>
            </div>
          }
          confirmLabel="Mover projeto para este servidor"
          onConfirm={() => {
            if (state.review != null) {
              state.move.mutate(state.review.request);
            }
          }}
        />
      )}
    </SettingsSection>
  );
}

function ServerMoveNotice({
  state,
  projectId,
}: {
  readonly state: ReturnType<typeof useServerMove>;
  readonly projectId: string;
}) {
  if (state.status.isError || state.servers.isError) {
    return (
      <div role="status" className="space-y-2 text-sm text-warning">
        <p>Não foi possível verificar os servidores e os impedimentos da troca.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={state.status.isFetching || state.servers.isFetching}
          onClick={() => {
            void Promise.all([state.status.refetch(), state.servers.refetch()]);
          }}
        >
          Atualizar disponibilidade dos servidores
        </Button>
      </div>
    );
  }
  if (state.status.data == null || state.servers.data == null) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Verificando destino, volumes, bancos e deploys…
      </p>
    );
  }
  if (state.blocker === "storage") {
    return (
      <div role="status" className="space-y-2 text-sm text-warning">
        <p>
          O projeto tem {pluralize(state.status.data.volumeCount, "volume", "volumes")} e{" "}
          {pluralize(state.status.data.databaseCount, "banco de dados", "bancos de dados")}. Os
          dados ficam no servidor atual e impedem a troca.
        </p>
        <div className="flex flex-wrap gap-4 text-foreground">
          {state.status.data.volumeCount > 0 ? (
            <Link
              to="/projects/$projectId/settings/volumes"
              params={{ projectId }}
              className="underline underline-offset-4"
            >
              Ver volumes
            </Link>
          ) : null}
          {state.status.data.databaseCount > 0 ? (
            <Link
              to="/projects/$projectId/databases"
              params={{ projectId }}
              className="underline underline-offset-4"
            >
              Ver bancos de dados
            </Link>
          ) : null}
        </div>
      </div>
    );
  }
  if (state.blocker === "deployment") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Há um deploy em andamento. Aguarde o término antes de mudar o servidor.
      </p>
    );
  }
  if (state.blocker === "approval") {
    return (
      <p role="status" className="text-sm text-warning">
        Aprove os deploys do projeto antes de mover a aplicação para outro servidor.
      </p>
    );
  }
  return null;
}
