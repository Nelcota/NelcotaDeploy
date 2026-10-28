import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleXIcon,
  LoaderCircleIcon,
  type LucideIcon,
} from "lucide-react";

import type { DeploymentStatus } from "@/deployments";

import { cn } from "./ui/class-names";

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

const STATE_STYLES: Record<StageState, { icon: LucideIcon; className: string; label: string }> = {
  done: { icon: CircleCheckIcon, className: "text-success", label: "concluído" },
  current: { icon: LoaderCircleIcon, className: "text-brand", label: "em andamento" },
  failed: { icon: CircleXIcon, className: "text-destructive", label: "falhou" },
  cancelled: { icon: CircleXIcon, className: "text-muted-foreground", label: "cancelado" },
  pending: { icon: CircleDashedIcon, className: "text-muted-foreground/60", label: "pendente" },
  skipped: { icon: CircleMinusIcon, className: "text-muted-foreground", label: "pulado" },
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

/** Horizontal progress of a deployment through its stages. */
export function DeploymentStages({ deployment }: { readonly deployment: StageSource }) {
  const states = stageStates(deployment);
  return (
    <ol aria-label="Etapas do deploy" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {STAGES.map((stage, index) => {
        const state = states[index] ?? "pending";
        const style = STATE_STYLES[state];
        return (
          <li
            key={stage.key}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
              state === "current" ? "border-primary/50 bg-accent" : "bg-card",
              state === "failed" ? "border-destructive/50 bg-destructive/10" : "",
            )}
          >
            <style.icon
              aria-hidden
              className={cn(
                "size-5 shrink-0",
                style.className,
                state === "current" ? "animate-spin" : "",
              )}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{stage.label}</span>
              <span className="block text-xs text-muted-foreground">{style.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
