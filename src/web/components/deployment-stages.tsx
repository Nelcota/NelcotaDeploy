import type { DeploymentStatus } from "@/deployments";

import { cn } from "./ui/class-names";

/** Stages per row on small screens, where the six do not fit side by side. */
const STAGES_PER_MOBILE_ROW = 3;

type StageState = "done" | "current" | "failed" | "cancelled" | "pending" | "skipped";

const STAGES = [
  { key: "queued", label: "Na fila" },
  { key: "cloning", label: "Clonando" },
  { key: "building", label: "Construindo" },
  { key: "starting", label: "Iniciando" },
  { key: "health_checking", label: "Saúde" },
  { key: "live", label: "No ar" },
] as const;

const CLONE_INDEX = 1;
const BUILD_INDEX = 2;
const START_INDEX = 3;
const HEALTH_INDEX = 4;
const LIVE_INDEX = 5;

const STATUS_INDEX: Readonly<Record<DeploymentStatus, number>> = {
  queued: 0,
  cloning: CLONE_INDEX,
  building: BUILD_INDEX,
  starting: START_INDEX,
  health_checking: HEALTH_INDEX,
  succeeded: LIVE_INDEX,
  failed: -1,
  cancelled: -1,
};

/** Dot, connector and label color of each state; the label text keeps color from being the only cue. */
const STATE_STYLES: Record<StageState, { dot: string; line: string; text: string; label: string }> =
  {
    done: { dot: "bg-success", line: "bg-success/60", text: "text-foreground", label: "concluído" },
    current: {
      dot: "bg-brand ring-4 ring-brand/20 animate-pulse",
      line: "bg-border",
      text: "text-foreground",
      label: "em andamento",
    },
    failed: {
      dot: "bg-destructive ring-4 ring-destructive/20",
      line: "bg-border",
      text: "text-destructive",
      label: "falhou",
    },
    cancelled: {
      dot: "bg-faint",
      line: "bg-border",
      text: "text-muted-foreground",
      label: "cancelado",
    },
    pending: {
      dot: "bg-background ring-1 ring-border",
      line: "bg-border",
      text: "text-faint",
      label: "pendente",
    },
    skipped: { dot: "bg-faint/50", line: "bg-border", text: "text-faint", label: "pulado" },
  };

/** Fields of a deployment that tell how far it got. */
export type StageSource = {
  readonly status: DeploymentStatus;
  readonly sourceDeploymentId: string | null;
  readonly commitSha: string | null;
  readonly imageTag: string | null;
  readonly containerName: string | null;
};

/**
 * Infers the stage where a failed or cancelled deployment stopped. The status history is not
 * stored, so the fields filled in along the way tell how far it got.
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

/**
 * Computes the state of every stage of a deployment.
 *
 * @param deployment - Status and the fields filled in while it ran.
 * @returns One state per stage, in order.
 */
export function stageStates(deployment: StageSource): StageState[] {
  const reusesImage = deployment.sourceDeploymentId != null;
  const stopped = deployment.status === "failed" || deployment.status === "cancelled";
  const currentIndex = stopped ? stoppedAt(deployment) : STATUS_INDEX[deployment.status];
  return STAGES.map((_, index) => {
    if (reusesImage && (index === CLONE_INDEX || index === BUILD_INDEX)) {
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

/** Horizontal progress of a deployment: connected dots with the stage names below. */
export function DeploymentStages({ deployment }: { readonly deployment: StageSource }) {
  const states = stageStates(deployment);
  return (
    <ol aria-label="Etapas do deploy" className="grid grid-cols-3 gap-y-5 sm:grid-cols-6">
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
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", style.dot)} />
              {last ? null : (
                <span
                  aria-hidden
                  className={cn(
                    "mx-2 h-px flex-1 rounded-full",
                    style.line,
                    // On three-column screens the third stage ends its row: no line to nowhere.
                    index === STAGES_PER_MOBILE_ROW - 1 ? "max-sm:invisible" : "",
                  )}
                />
              )}
            </div>
            <p className={cn("pr-2 text-xs font-medium sm:truncate sm:text-sm", style.text)}>
              {stage.label}
              <span className="sr-only">: {style.label}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
