import type { DeploymentStatus } from "@/deployments";
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  CONTAINER_STATE_LABELS,
  DEPLOYMENT_STATUS_LABELS,
  TASK_STATUS_LABELS,
} from "@/web/components/layout/labels";
import { cn } from "@/web/components/ui/class-names";

type Tone = "success" | "danger" | "progress" | "neutral" | "warning";

const TONE_TEXT: Record<Tone, string> = {
  success: "text-success",
  danger: "text-destructive",
  progress: "text-brand",
  warning: "text-warning",
  neutral: "text-muted-foreground",
};

const TONE_BACKGROUND: Record<Tone, string> = {
  success: "bg-success/12",
  danger: "bg-destructive/12",
  progress: "bg-brand/14",
  warning: "bg-warning/12",
  neutral: "bg-well",
};

/** Status as a tinted label. The text always names the state, so color is never the only cue. */
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
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_TEXT[tone],
        TONE_BACKGROUND[tone],
        className,
      )}
    >
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
