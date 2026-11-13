import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleSlashIcon,
  CircleXIcon,
  LoaderCircleIcon,
  type LucideIcon,
} from "lucide-react";

import type { DeploymentStage, DeploymentStatus } from "@/deployments";
import { cn } from "@/web/components/ui/class-names";

/** Stages per row on small screens, where the six do not fit side by side. */
const STAGES_PER_MOBILE_ROW = 3;

type StageState = "done" | "current" | "failed" | "cancelled" | "pending" | "skipped";

const STAGES = [
  { key: "queued", label: "Preparação", failureLabel: "Preparação do deploy" },
  { key: "cloning", label: "Clonando", failureLabel: "Clonagem do repositório" },
  { key: "building", label: "Construindo", failureLabel: "Construção da imagem" },
  { key: "starting", label: "Iniciando", failureLabel: "Inicialização da aplicação" },
  {
    key: "health_checking",
    label: "Verificação",
    failureLabel: "Verificação de saúde",
  },
  { key: "publishing", label: "Publicando", failureLabel: "Publicação da versão" },
  { key: "live", label: "No ar" },
] as const;

const CLONE_INDEX = 1;
const BUILD_INDEX = 2;
const START_INDEX = 3;
const HEALTH_INDEX = 4;
const PUBLISH_INDEX = 5;
const LIVE_INDEX = 6;

const STATUS_INDEX: Readonly<Record<DeploymentStatus, number>> = {
  queued: 0,
  cloning: CLONE_INDEX,
  building: BUILD_INDEX,
  starting: START_INDEX,
  health_checking: HEALTH_INDEX,
  publishing: PUBLISH_INDEX,
  succeeded: LIVE_INDEX,
  failed: -1,
  cancelled: -1,
};

/** Icon, connector and label color of each state; the icon shape keeps color from being the only cue. */
const STATE_STYLES: Record<
  StageState,
  { icon: LucideIcon; iconClass: string; line: string; text: string; label: string }
> = {
  done: {
    icon: CircleCheckIcon,
    iconClass: "text-success",
    line: "bg-success/60",
    text: "text-foreground",
    label: "concluído",
  },
  current: {
    icon: LoaderCircleIcon,
    iconClass: "text-brand motion-safe:animate-spin",
    line: "bg-border",
    text: "text-foreground",
    label: "em andamento",
  },
  failed: {
    icon: CircleXIcon,
    iconClass: "text-destructive",
    line: "bg-border",
    text: "text-destructive",
    label: "falhou",
  },
  cancelled: {
    icon: CircleSlashIcon,
    iconClass: "text-muted-foreground",
    line: "bg-border",
    text: "text-muted-foreground",
    label: "cancelado",
  },
  pending: {
    icon: CircleIcon,
    iconClass: "text-faint",
    line: "bg-border",
    text: "text-faint",
    label: "pendente",
  },
  skipped: {
    icon: CircleDashedIcon,
    iconClass: "text-faint",
    line: "bg-border",
    text: "text-faint",
    label: "pulado",
  },
};

/** Fields of a deployment that tell how far it got. */
export type StageSource = {
  readonly status: DeploymentStatus;
  readonly failureStage?: DeploymentStage | null;
  readonly sourceDeploymentId: string | null;
  readonly commitSha: string | null;
  readonly imageTag: string | null;
  readonly containerName: string | null;
};

/**
 * Infers where older failed or cancelled deployments stopped from their recorded progress.
 */
function stoppedAt(deployment: StageSource): number {
  const reusesImage = deployment.sourceDeploymentId != null;
  if (reusesImage === false && deployment.commitSha == null && deployment.imageTag == null) {
    return CLONE_INDEX;
  }
  if (deployment.imageTag == null) {
    return BUILD_INDEX;
  }
  return deployment.containerName == null ? START_INDEX : HEALTH_INDEX;
}

/** Describes the recorded failure stage, with an estimate for older deployments. */
export function deploymentFailureStage(deployment: StageSource): string | null {
  if (deployment.status !== "failed") {
    return null;
  }

  if (deployment.failureStage == null && stoppedAt(deployment) === HEALTH_INDEX) {
    return "Inicialização ou verificação de saúde";
  }

  const stage = STAGES[failedAt(deployment)];
  return stage != null && "failureLabel" in stage ? stage.failureLabel : null;
}

function failedAt(deployment: StageSource): number {
  return deployment.failureStage == null
    ? stoppedAt(deployment)
    : STATUS_INDEX[deployment.failureStage];
}

/**
 * Computes the state of every stage of a deployment.
 *
 * @param deployment - Status and the fields filled in while it ran.
 * @returns One state per stage, in order.
 */
export function stageStates(deployment: StageSource): StageState[] {
  const currentIndex = stageIndex(deployment);
  const skipsBuild =
    deployment.sourceDeploymentId != null &&
    currentIndex !== CLONE_INDEX &&
    currentIndex !== BUILD_INDEX;
  return STAGES.map((_, index) => {
    if (skipsBuild && (index === CLONE_INDEX || index === BUILD_INDEX)) {
      return "skipped";
    }
    if (index < currentIndex || (deployment.status === "succeeded" && index === LIVE_INDEX)) {
      return "done";
    }
    if (index > currentIndex) {
      return "pending";
    }
    if (deployment.status === "failed") {
      return "failed";
    }
    return deployment.status === "cancelled" ? "cancelled" : "current";
  });
}

function stageIndex(deployment: StageSource): number {
  if (deployment.status === "failed") {
    return failedAt(deployment);
  }

  if (deployment.status === "cancelled") {
    return stoppedAt(deployment);
  }

  return STATUS_INDEX[deployment.status];
}

/** Horizontal progress of a deployment: connected dots with the stage names below. */
export function DeploymentStages({ deployment }: { readonly deployment: StageSource }) {
  const states = stageStates(deployment);
  return (
    <ol aria-label="Etapas do deploy" className="grid grid-cols-3 gap-y-5 sm:grid-cols-7">
      {STAGES.map((stage, index) => {
        const state = states[index] ?? "pending";
        const style = STATE_STYLES[state];
        const last = index === STAGES.length - 1;
        return (
          <li
            key={stage.key}
            aria-current={state === "current" ? "step" : undefined}
            className="relative min-w-0 space-y-2.5"
          >
            <div className="flex items-center">
              <style.icon aria-hidden className={cn("size-4 shrink-0", style.iconClass)} />
              {last ? null : (
                <span
                  aria-hidden
                  className={cn(
                    "mx-2 h-px flex-1 rounded-full",
                    style.line,
                    // On three-column screens the third stage ends its row: no line to nowhere.
                    (index + 1) % STAGES_PER_MOBILE_ROW === 0 ? "max-sm:invisible" : "",
                  )}
                />
              )}
            </div>
            <p className={cn("pr-2 text-xs font-medium sm:truncate sm:text-sm", style.text)}>
              {stage.key === "queued" && state === "current" ? "Na fila" : stage.label}
              {/* Done and pending stages read clearly from the line; the others say their state. */}
              {state === "done" || state === "pending" ? (
                <span className="sr-only">: {style.label}</span>
              ) : (
                <span className="block text-xs font-normal text-muted-foreground">
                  {style.label}
                </span>
              )}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
