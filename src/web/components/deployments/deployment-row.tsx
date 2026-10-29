import { useNavigate } from "@tanstack/react-router";
import { ClockIcon, TimerIcon, UserRoundIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import type { DeploymentTrigger } from "@/deployments";
import { durationBetween, formatDateTime, formatDuration, formatShortTime } from "@/shared/format";
import {
  DEPLOYMENT_TRIGGER_ICONS,
  DEPLOYMENT_TRIGGER_LABELS,
} from "@/web/components/layout/labels";
import { ListRow } from "@/web/components/layout/layout";

/** Elements whose clicks belong to themselves, not to the row. */
const INTERACTIVE_SELECTOR = "a, button, input, select, [role='dialog'], [role='alertdialog']";

/**
 * List row ({@link ListRow}) that opens a deployment when clicked anywhere. Links and buttons
 * inside keep their own behavior.
 */
export function DeploymentListRow({
  projectId,
  deploymentId,
  children,
}: {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly children: ReactNode;
}) {
  const navigate = useNavigate();
  const open = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR) != null) {
      return;
    }
    void navigate({
      to: "/projects/$projectId/deployments/$deploymentId",
      params: { projectId, deploymentId },
    });
  };
  return (
    // The commit link inside the row is the keyboard path; the click target is a convenience.
    <div onClick={open} className="cursor-pointer has-[a:focus-visible]:bg-well/50">
      <ListRow>{children}</ListRow>
    </div>
  );
}

type DeploymentTiming = {
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
};

const META_LINE = "flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground";

/** Origin of a deploy and who started it, as a column of a deploy list (md and up). */
export function DeploymentOriginColumn({
  trigger,
  triggeredBy,
}: {
  readonly trigger: DeploymentTrigger;
  readonly triggeredBy: string;
}) {
  const TriggerIcon = DEPLOYMENT_TRIGGER_ICONS[trigger];
  return (
    <div className="hidden w-40 shrink-0 space-y-0.5 md:block">
      <p className={META_LINE}>
        <TriggerIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{DEPLOYMENT_TRIGGER_LABELS[trigger]}</span>
      </p>
      <p className={META_LINE} title={triggeredBy}>
        <UserRoundIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{triggeredBy}</span>
      </p>
    </div>
  );
}

/** Start time and duration of a deploy, as a column of a deploy list (sm and up). */
export function DeploymentTimingColumn({ timing }: { readonly timing: DeploymentTiming }) {
  return (
    <div className="hidden w-24 shrink-0 space-y-0.5 sm:block">
      <p className={`${META_LINE} justify-end tabular-nums`}>
        <ClockIcon aria-hidden className="size-3.5 shrink-0" />
        <time dateTime={timing.createdAt} title={formatDateTime(timing.createdAt)}>
          {formatShortTime(timing.createdAt)}
        </time>
      </p>
      <p className={`${META_LINE} justify-end tabular-nums`}>
        <TimerIcon aria-hidden className="size-3.5 shrink-0" />
        {formatDuration(durationBetween(timing.startedAt, timing.finishedAt))}
      </p>
    </div>
  );
}

/**
 * Time and duration on one line, plus the commit when the row does not show it already, for
 * phones where the columns are hidden.
 */
export function DeploymentMobileMeta({
  shortSha,
  timing,
}: {
  readonly shortSha?: string;
  readonly timing: DeploymentTiming;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground sm:hidden">
      {shortSha == null ? null : <span className="font-mono">{shortSha}</span>}
      <span className="inline-flex items-center gap-1 tabular-nums">
        <ClockIcon aria-hidden className="size-3.5" />
        <time dateTime={timing.createdAt}>{formatShortTime(timing.createdAt)}</time>
      </span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <TimerIcon aria-hidden className="size-3.5" />
        {formatDuration(durationBetween(timing.startedAt, timing.finishedAt))}
      </span>
    </p>
  );
}
