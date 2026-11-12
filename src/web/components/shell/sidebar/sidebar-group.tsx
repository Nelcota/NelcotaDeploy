import { type ReactNode, useId } from "react";

import type { SidebarGroupId } from "@/web/components/shell/sidebar/sidebar-preferences";
import type { SidebarState } from "@/web/components/shell/sidebar/use-sidebar-preferences";

type SidebarGroupProps = {
  readonly group: SidebarGroupId;
  readonly label: string;
  readonly children: ReactNode;
  readonly collapsed: boolean;
  readonly sidebar: SidebarState;
  readonly actions?: ReactNode;
};

/** Named navigation group with an independent disclosure in the expanded sidebar. */
export function SidebarGroup({
  group,
  label,
  children,
  collapsed,
  sidebar,
  actions,
}: SidebarGroupProps) {
  const contentId = useId();
  const { closedGroups } = sidebar.preferences;
  const expanded = collapsed || closedGroups.includes(group) === false;

  const toggleGroup = () => {
    const nextGroups = expanded
      ? [...closedGroups, group]
      : closedGroups.filter((closedGroup) => closedGroup !== group);
    sidebar.updatePreferences({ ...sidebar.preferences, closedGroups: nextGroups });
  };

  return (
    <div role="group" aria-label={label}>
      <div className="flex items-center gap-1 empty:hidden">
        {collapsed ? null : (
          <button
            type="button"
            aria-controls={contentId}
            aria-expanded={expanded}
            onClick={toggleGroup}
            className="group flex min-h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-left text-xs font-medium text-faint hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
          >
            <span className="truncate">{label}</span>
            <span
              aria-hidden
              className="solar-[alt-arrow-down-linear] size-3.5 shrink-0 -rotate-90 group-aria-expanded:rotate-0 motion-safe:transition-transform"
            />
          </button>
        )}
        {actions}
      </div>
      <div id={contentId} hidden={expanded === false}>
        {children}
      </div>
    </div>
  );
}
