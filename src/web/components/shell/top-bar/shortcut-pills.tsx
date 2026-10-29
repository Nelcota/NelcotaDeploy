import { Link } from "@tanstack/react-router";

import { useDashboardCounts, useSystemStatus } from "@/web/components/shell/use-shell-queries";

function ShortcutPill({
  to,
  status,
  label,
  count,
}: {
  readonly to: "/projects" | "/deployments";
  /** Projects filter the shortcut opens with. */
  readonly status?: "online" | "offline";
  readonly label: string;
  readonly count: number | null;
}) {
  return (
    <Link
      to={to}
      search={to === "/projects" ? { status } : {}}
      activeOptions={{ exact: true, includeSearch: true }}
      className="group flex h-10 items-center gap-2.5 rounded-full bg-well px-4 text-sm whitespace-nowrap ring-1 ring-border transition-colors hover:bg-well-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-primary data-[status=active]:text-primary-foreground data-[status=active]:ring-primary"
    >
      {label}
      <span className="rounded-md bg-background/60 px-1.5 text-xs text-muted-foreground tabular-nums group-data-[status=active]:bg-white/20 group-data-[status=active]:text-primary-foreground">
        {count ?? "–"}
      </span>
    </Link>
  );
}

/** Quick counts that answer "is anything wrong?" from any page. */
export function ShortcutPills() {
  const dashboard = useDashboardCounts();
  const status = useSystemStatus();
  return (
    <nav aria-label="Atalhos" className="hidden items-center gap-2 min-[1400px]:flex">
      <ShortcutPill
        to="/projects"
        status="online"
        label="Online"
        count={dashboard.data?.onlineCount ?? null}
      />
      <ShortcutPill
        to="/projects"
        status="offline"
        label="Precisam de atenção"
        count={dashboard.data?.offlineCount ?? null}
      />
      <ShortcutPill
        to="/deployments"
        label="Em andamento"
        count={status.data?.activeDeployments ?? null}
      />
    </nav>
  );
}
