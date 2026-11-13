import { Link } from "@tanstack/react-router";
import { type Ref, useId, useRef, useState } from "react";

import { cn } from "@/web/components/ui/class-names";

import {
  type ProjectSettingsDestination,
  SETTINGS_HEADING_ID,
} from "./navigation/settings-destinations";

const NAVIGATION_LINK =
  "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-well hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-accent-foreground";

function SettingsLink({
  projectId,
  destination,
  current,
}: {
  readonly projectId: string;
  readonly destination: ProjectSettingsDestination;
  readonly current: boolean;
}) {
  return (
    <Link
      to={destination.to}
      params={{ projectId }}
      hash={SETTINGS_HEADING_ID}
      activeOptions={{ exact: true }}
      preload={false}
      className={cn(NAVIGATION_LINK, destination.id === "deletion" && "text-destructive")}
    >
      <span aria-hidden className={cn("size-4 shrink-0", destination.icon)} />
      <span className="min-w-0 flex-1">{destination.label}</span>
      {current ? (
        <span aria-hidden className="solar-[check-circle-bold-duotone] size-4 shrink-0" />
      ) : null}
    </Link>
  );
}

type NavigationProps = {
  readonly projectId: string;
  readonly destinations: readonly ProjectSettingsDestination[];
  readonly current: ProjectSettingsDestination | undefined;
  readonly overview: boolean;
};

function SettingsLinks({ projectId, destinations, current, overview }: NavigationProps) {
  const groups = Map.groupBy(destinations, (destination) => destination.group);
  return (
    <ul className="space-y-3">
      <li>
        <Link
          to="/projects/$projectId/settings"
          params={{ projectId }}
          hash={SETTINGS_HEADING_ID}
          activeOptions={{ exact: true }}
          preload={false}
          className={NAVIGATION_LINK}
        >
          <span aria-hidden className="solar-[settings-bold-duotone] size-4 shrink-0" />
          <span className="flex-1">Todas as seções</span>
          {overview ? (
            <span aria-hidden className="solar-[check-circle-bold-duotone] size-4 shrink-0" />
          ) : null}
        </Link>
      </li>
      {Array.from(groups, ([group, sections]) => (
        <li key={group}>
          <p className="px-2.5 pb-0.5 text-xs font-semibold text-muted-foreground">{group}</p>
          <ul aria-label={group}>
            {sections.map((destination) => (
              <li key={destination.id}>
                <SettingsLink
                  projectId={projectId}
                  destination={destination}
                  current={current?.id === destination.id}
                />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function SettingsMenuTrigger({
  current,
  navigationId,
  open,
  onToggle,
  ref,
}: {
  readonly current: ProjectSettingsDestination | undefined;
  readonly navigationId: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly ref: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls={navigationId}
      onClick={onToggle}
      className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring @min-[52rem]/settings:hidden"
    >
      <span
        aria-hidden
        className={cn(
          "size-5 shrink-0 text-accent-foreground",
          current?.icon ?? "solar-[settings-bold-duotone]",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">Seções de configuração</span>
        {current == null ? null : (
          <span className="block text-sm font-semibold">{current.label}</span>
        )}
      </span>
      <span
        aria-hidden
        className={cn("solar-[alt-arrow-down-linear] size-4 shrink-0", open && "rotate-180")}
      />
    </button>
  );
}

/** Keeps the same section links in the desktop rail and the mobile disclosure. */
export function ProjectSettingsNavigation(props: NavigationProps) {
  const { current, overview } = props;
  const navigationId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        "sticky top-0 z-20 min-w-0 self-start rounded-xl bg-panel",
        overview ? "hidden @min-[52rem]/settings:block" : "w-full",
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open && trigger.current?.offsetParent != null) {
          setOpen(false);
          trigger.current.focus();
        }
      }}
    >
      {overview ? null : (
        <SettingsMenuTrigger
          ref={trigger}
          current={current}
          navigationId={navigationId}
          open={open}
          onToggle={() => setOpen((expanded) => expanded === false)}
        />
      )}
      <nav
        id={navigationId}
        aria-label="Seções de configuração"
        className={cn(
          "max-h-[min(55svh,28rem)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface-raised p-2 shadow-lg @min-[52rem]/settings:mt-0 @min-[52rem]/settings:block @min-[52rem]/settings:max-h-[calc(100svh-7rem)] @min-[52rem]/settings:shadow-none",
          open ? "mt-2" : "hidden",
        )}
      >
        <SettingsLinks {...props} />
      </nav>
    </div>
  );
}
