import { Link } from "@tanstack/react-router";
import { type Ref, useId, useRef, useState } from "react";

import type { AdministrationSection } from "@/web/components/shell/navigation/administration-destinations";
import { cn } from "@/web/components/ui/class-names";

const NAVIGATION_LINK =
  "group flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-well hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-accent-foreground";
const CURRENT_ICON =
  "solar-[check-circle-bold-duotone] hidden size-4 shrink-0 group-aria-[current=page]:block";
const SETTINGS_ICON = "solar-[settings-bold-duotone]";

function AdministrationLinks({
  sections,
}: {
  readonly sections: readonly AdministrationSection[];
}) {
  const groups = Map.groupBy(sections, (section) => section.group);
  return (
    <ul className="space-y-3">
      <li>
        <Link
          to="/settings"
          search={{}}
          activeOptions={{ exact: true }}
          preload={false}
          className={NAVIGATION_LINK}
        >
          <span aria-hidden className={cn("size-4 shrink-0", SETTINGS_ICON)} />
          <span className="min-w-0 flex-1">Todas as seções</span>
          <span aria-hidden className={CURRENT_ICON} />
        </Link>
      </li>
      {Array.from(groups, ([group, destinations]) => (
        <li key={group}>
          <p className="px-2.5 pb-0.5 text-xs font-semibold text-muted-foreground">{group}</p>
          <ul aria-label={group}>
            {destinations.map((section) => (
              <li key={section.to}>
                <Link
                  to={section.to}
                  activeOptions={{ exact: true }}
                  preload={false}
                  className={NAVIGATION_LINK}
                >
                  <span aria-hidden className={cn("size-4 shrink-0", section.solarIcon)} />
                  <span className="min-w-0 flex-1">{section.label}</span>
                  <span aria-hidden className={CURRENT_ICON} />
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function AdministrationMenuTrigger({
  current,
  navigationId,
  open,
  onToggle,
  ref,
}: {
  readonly current: AdministrationSection | undefined;
  readonly navigationId: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly ref: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-controls={navigationId}
      aria-expanded={open}
      onClick={onToggle}
      className="group flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring @min-[52rem]/settings:hidden"
    >
      <span
        aria-hidden
        className={cn(
          "size-5 shrink-0 text-accent-foreground",
          current?.solarIcon ?? SETTINGS_ICON,
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">Seções da administração</span>
        <span className="block text-sm font-semibold">{current?.label ?? "Escolher seção"}</span>
      </span>
      <span
        aria-hidden
        className="solar-[alt-arrow-down-linear] size-4 shrink-0 group-aria-expanded:rotate-180"
      />
    </button>
  );
}

/** Offers the same destinations in a sticky desktop rail and a mobile disclosure. */
export function AdministrationNavigation({
  sections,
  current,
  overview,
}: {
  readonly sections: readonly AdministrationSection[];
  readonly current: AdministrationSection | undefined;
  readonly overview: boolean;
}) {
  const navigationId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "sticky top-0 z-20 min-w-0 self-start rounded-xl bg-panel",
        overview && "hidden @min-[52rem]/settings:block",
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open && trigger.current?.offsetParent != null) {
          setOpen(false);
          trigger.current.focus();
        }
      }}
    >
      {overview ? null : (
        <AdministrationMenuTrigger
          ref={trigger}
          current={current}
          navigationId={navigationId}
          open={open}
          onToggle={() => setOpen((expanded) => expanded === false)}
        />
      )}
      <nav
        id={navigationId}
        aria-label="Seções da administração"
        className={cn(
          "max-h-[min(55dvh,28rem)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface-raised p-2 shadow-lg @min-[52rem]/settings:mt-0 @min-[52rem]/settings:block @min-[52rem]/settings:max-h-[calc(100dvh-7rem)] @min-[52rem]/settings:shadow-none",
          open ? "mt-2" : "hidden",
        )}
      >
        <AdministrationLinks sections={sections} />
      </nav>
    </div>
  );
}
