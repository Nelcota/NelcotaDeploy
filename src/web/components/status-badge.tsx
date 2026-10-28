import type { DeploymentStatus } from "@/deployments";

import {
  ACTIVE_DEPLOYMENT_STATUSES,
  CONTAINER_STATE_LABELS,
  DEPLOYMENT_STATUS_LABELS,
  TASK_STATUS_LABELS,
} from "./labels";
import { cn } from "./ui/class-names";

type Tone = "success" | "danger" | "progress" | "neutral" | "warning";

const TONE_TEXT: Record<Tone, string> = {
  success: "text-success",
  danger: "text-destructive",
  progress: "text-brand",
  warning: "text-warning",
  neutral: "text-muted-foreground",
};

const TONE_DOT: Record<Tone, string> = {
  success: "bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_18%,transparent)]",
  danger:
    "bg-destructive shadow-[0_0_0_3px_color-mix(in_oklab,var(--destructive)_18%,transparent)]",
  progress: "bg-brand animate-pulse",
  warning: "bg-warning shadow-[0_0_0_3px_color-mix(in_oklab,var(--warning)_18%,transparent)]",
  neutral: "bg-faint",
};

/** Status as a colored dot and text. The text always names the state, so color is never the only cue. */
export function StatusPill({
  tone,
  label,
  className,
}: {
  readonly tone: Tone;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap",
        TONE_TEXT[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])} />
      {label}
    </span>
  );
}

function deploymentTone(status: DeploymentStatus): Tone {
  if (status === "succeeded") {
    return "success";
  }
  if (status === "failed") {
    return "danger";
  }
  if (status === "cancelled") {
    return "neutral";
  }
  return ACTIVE_DEPLOYMENT_STATUSES.has(status) ? "progress" : "neutral";
}

export function DeploymentStatusBadge({ status }: { readonly status: DeploymentStatus }) {
  return <StatusPill tone={deploymentTone(status)} label={DEPLOYMENT_STATUS_LABELS[status]} />;
}

export function ContainerStateBadge({
  state,
  health,
}: {
  readonly state: string | null;
  readonly health?: string | null;
}) {
  if (state == null) {
    return <StatusPill tone="neutral" label="Sem contêiner" />;
  }
  if (state === "running" && health === "unhealthy") {
    return <StatusPill tone="danger" label="Online, sem saúde" />;
  }
  const label = CONTAINER_STATE_LABELS[state] ?? state;
  if (state === "running") {
    return <StatusPill tone="success" label={label} />;
  }
  if (state === "restarting") {
    return <StatusPill tone="warning" label={label} />;
  }
  return <StatusPill tone={state === "dead" ? "danger" : "neutral"} label={label} />;
}

export function TaskStatusBadge({ status }: { readonly status: string }) {
  const tones: Record<string, Tone> = {
    queued: "neutral",
    running: "progress",
    succeeded: "success",
    failed: "danger",
  };
  return (
    <StatusPill tone={tones[status] ?? "neutral"} label={TASK_STATUS_LABELS[status] ?? status} />
  );
}
