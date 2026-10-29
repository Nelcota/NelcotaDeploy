import {
  EllipsisIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PlayIcon,
  RefreshCwIcon,
  RocketIcon,
  RotateCwIcon,
  SquareIcon,
} from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import {
  type ContainerAction,
  useProjectActions,
} from "@/web/components/projects/use-project-actions";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";

const STOP_DESCRIPTION =
  "O contêiner será parado e a aplicação ficará fora do ar até ser iniciada novamente.";
const REDEPLOY_DESCRIPTION =
  "Um novo contêiner será criado com a imagem atual, aplicando as variáveis e domínios salvos, sem novo build. Pode haver uma breve troca de versão durante a substituição.";

type Confirmation = "stop" | "redeploy";

function ContainerMenuItems({
  containerState,
  busy,
  onAction,
  onStop,
}: {
  readonly containerState: string | null;
  readonly busy: boolean;
  readonly onAction: (action: ContainerAction) => void;
  readonly onStop: () => void;
}) {
  if (containerState == null) {
    return <DropdownMenuItem disabled>Nenhum contêiner ativo</DropdownMenuItem>;
  }
  const running = containerState === "running";
  return (
    <>
      <DropdownMenuItem disabled={busy || running} onSelect={() => onAction("start")}>
        <PlayIcon aria-hidden />
        Iniciar
      </DropdownMenuItem>
      <DropdownMenuItem disabled={busy || running === false} onSelect={() => onAction("restart")}>
        <RotateCwIcon aria-hidden />
        Reiniciar
      </DropdownMenuItem>
      <DropdownMenuItem disabled={busy || running === false} onSelect={onStop}>
        <SquareIcon aria-hidden />
        Parar
      </DropdownMenuItem>
    </>
  );
}

function MoreActionsMenu({
  canControl,
  canRedeploy,
  containerState,
  busy,
  onAction,
  onConfirm,
}: {
  readonly canControl: boolean;
  readonly canRedeploy: boolean;
  readonly containerState: string | null;
  readonly busy: boolean;
  readonly onAction: (action: ContainerAction) => void;
  readonly onConfirm: (confirmation: Confirmation) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Mais ações">
          <EllipsisIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {canControl ? (
          <ContainerMenuItems
            containerState={containerState}
            busy={busy}
            onAction={onAction}
            onStop={() => onConfirm("stop")}
          />
        ) : null}
        {canControl && canRedeploy ? <DropdownMenuSeparator /> : null}
        {canRedeploy ? (
          <DropdownMenuItem disabled={busy} onSelect={() => onConfirm("redeploy")}>
            <RefreshCwIcon aria-hidden />
            Redeploy sem build
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OpenAppButton({ url }: { readonly url: string }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={url} target="_blank" rel="noreferrer noopener">
        <ExternalLinkIcon aria-hidden />
        Abrir
        <span className="sr-only"> a aplicação em nova aba</span>
      </a>
    </Button>
  );
}

function DeployButton({
  busy,
  deploying,
  onDeploy,
}: {
  readonly busy: boolean;
  readonly deploying: boolean;
  readonly onDeploy: () => void;
}) {
  return (
    <Button size="sm" disabled={busy} onClick={onDeploy}>
      {deploying ? (
        <LoaderCircleIcon aria-hidden className="animate-spin" />
      ) : (
        <RocketIcon aria-hidden />
      )}
      Deploy
    </Button>
  );
}

function ActionConfirmations({
  confirming,
  onConfirmingChange,
  onStop,
  onRedeploy,
}: {
  readonly confirming: Confirmation | null;
  readonly onConfirmingChange: (confirming: Confirmation | null) => void;
  readonly onStop: () => void;
  readonly onRedeploy: () => void;
}) {
  return (
    <>
      <ConfirmDialog
        open={confirming === "stop"}
        onOpenChange={(open) => onConfirmingChange(open ? "stop" : null)}
        title="Parar a aplicação?"
        description={STOP_DESCRIPTION}
        confirmLabel="Parar"
        destructive
        onConfirm={onStop}
      />
      <ConfirmDialog
        open={confirming === "redeploy"}
        onOpenChange={(open) => onConfirmingChange(open ? "redeploy" : null)}
        title="Recriar o contêiner?"
        description={REDEPLOY_DESCRIPTION}
        confirmLabel="Fazer redeploy"
        onConfirm={onRedeploy}
      />
    </>
  );
}

/**
 * Buttons of the project header: open the app, the container and redeploy menu, and deploy.
 * Each action only shows when the user is allowed to run it.
 */
export function ProjectActions({
  details,
  containerState,
  url,
}: {
  readonly details: ProjectDetails;
  /** State of the live container, or null when there is none. */
  readonly containerState: string | null;
  readonly url: string | null;
}) {
  const { project } = details;
  const can = useCan();
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const { deploy, redeploy, containerAction, busy } = useProjectActions(project.id);

  const hasDeployment = project.currentDeploymentId != null;
  const canDeploy = can("deployment:create") && project.deploymentsApproved;
  const canControl = can("container:control") && hasDeployment;
  const canRedeploy = canDeploy && hasDeployment;

  return (
    <div className="flex items-center gap-2 max-lg:border-b max-lg:border-border/70 max-lg:pb-4">
      {url == null ? null : <OpenAppButton url={url} />}
      {canControl || canRedeploy ? (
        <MoreActionsMenu
          canControl={canControl}
          canRedeploy={canRedeploy}
          containerState={containerState}
          busy={busy}
          onAction={(action) => containerAction.mutate(action)}
          onConfirm={setConfirming}
        />
      ) : null}
      {canDeploy ? (
        <DeployButton busy={busy} deploying={deploy.isPending} onDeploy={() => deploy.mutate()} />
      ) : null}
      <ActionConfirmations
        confirming={confirming}
        onConfirmingChange={setConfirming}
        onStop={() => containerAction.mutate("stop")}
        onRedeploy={() => redeploy.mutate()}
      />
    </div>
  );
}
