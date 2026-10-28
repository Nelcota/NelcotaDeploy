import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleOffIcon,
  CircleXIcon,
  type LucideIcon,
  LoaderCircleIcon,
} from "lucide-react";

import type { DeploymentStatus } from "@/deployments";

import {
  ACTIVE_DEPLOYMENT_STATUSES,
  CONTAINER_STATE_LABELS,
  DEPLOYMENT_STATUS_LABELS,
  TASK_STATUS_LABELS,
} from "./labels";
import { cn } from "./ui/class-names";

type Tone = "success" | "danger" | "progress" | "neutral" | "warning";

const TONE_CLASSES: Record<Tone, string> = {
  success: "border-success/25 bg-success/12 text-success",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  progress: "border-primary/30 bg-primary/12 text-brand",
  warning: "border-warning/30 bg-warning/10 text-warning",
  neutral: "border-border bg-secondary text-muted-foreground",
};

const TONE_ICONS: Record<Tone, LucideIcon> = {
  success: CircleCheckIcon,
  danger: CircleXIcon,
  progress: LoaderCircleIcon,
  warning: CircleOffIcon,
  neutral: CircleDashedIcon,
};

/** Small pill with an icon and text, so the state never depends on color alone. */
export function StatusPill({
  tone,
  label,
  className,
}: {
  readonly tone: Tone;
  readonly label: string;
  readonly className?: string;
}) {
  const Icon = TONE_ICONS[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.8rem] leading-none font-semibold whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-3.5", tone === "progress" ? "animate-spin" : "")} />
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
