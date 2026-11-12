import { Link } from "@tanstack/react-router";

const DEPLOYMENT_PAGES = [
  { to: "/activity", label: "Recentes", icon: "solar-[history-bold-duotone]" },
  { to: "/deployments", label: "Histórico", icon: "solar-[rocket-2-bold-duotone]" },
  { to: "/deployment-statistics", label: "Estatísticas", icon: "solar-[chart-2-bold-duotone]" },
] as const;

/** Direct links between the feed, the searchable history, and aggregate metrics. */
export function DeploymentNavigation() {
  return (
    <nav aria-label="Páginas de deploys" className="border-b border-border pb-2">
      <ul className="flex flex-wrap gap-1">
        {DEPLOYMENT_PAGES.map(({ to, label, icon }) => (
          <li key={to}>
            <Link
              to={to}
              activeOptions={{ exact: true, includeSearch: false }}
              className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:bg-well aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
            >
              <span aria-hidden className={`size-4 shrink-0 ${icon}`} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
