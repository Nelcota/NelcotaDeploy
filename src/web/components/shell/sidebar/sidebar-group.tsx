import type { ReactNode } from "react";

/** Labelled block of sidebar links. */
export function SidebarGroup({
  label,
  children,
  collapsed = false,
  actions,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly collapsed?: boolean;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex min-h-6 items-center justify-between gap-1 pb-1">
        <p
          className={
            collapsed
              ? "sr-only"
              : "truncate px-3 text-xs font-medium tracking-wider text-faint uppercase"
          }
        >
          {label}
        </p>
        {actions}
      </div>
      {children}
    </div>
  );
}
