import type { ReactNode } from "react";

/** Labelled block of sidebar links. */
export function SidebarGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="px-3 pb-1 text-xs font-medium tracking-wider text-faint uppercase">{label}</p>
      {children}
    </div>
  );
}
