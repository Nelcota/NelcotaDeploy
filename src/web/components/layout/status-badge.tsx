import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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

/** Small tinted label beside a name, such as "Secret", "HTTPS" or "Pausada". */
const TAG_TONES = {
  neutral: "bg-well text-muted-foreground ring-border/60",
  danger: "bg-destructive/10 text-destructive ring-destructive/25",
  warning: "bg-warning/10 text-warning ring-warning/25",
  success: "bg-success/10 text-success ring-success/25",
} as const;

export function Tag({
  icon: Icon,
  tone = "neutral",
  children,
}: {
  readonly icon?: LucideIcon;
  /** Draws the eye to a state, like a secret or a broken record; the text still says it. */
  readonly tone?: keyof typeof TAG_TONES;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs ring-1",
        TAG_TONES[tone],
      )}
    >
      {Icon == null ? null : <Icon aria-hidden className="size-3.5" />}
      {children}
    </span>
  );
}

/** Marks the deployment a project is serving right now. */
export function LiveBadge() {
  return (
    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
      No ar
    </span>
  );
}

/** Marks a version the panel rolled back on its own because its containers kept restarting. */
export function AutoRolledBackBadge() {
  return (
    <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
      Revertido automaticamente
    </span>
  );
}
