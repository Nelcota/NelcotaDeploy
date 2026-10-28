import { useQuery } from "@tanstack/react-query";
import {
  Link,
  type LinkComponentProps,
  useNavigate,
  useParams,
  useRouter,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import {
  ActivityIcon,
  BoxesIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  ClockIcon,
  FolderIcon,
  GaugeIcon,
  GlobeIcon,
  HomeIcon,
  LayoutListIcon,
  LogOutIcon,
  type LucideIcon,
  MenuIcon,
  MoonIcon,
  PlusIcon,
  RocketIcon,
  ScrollTextIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SunIcon,
  VariableIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { getSidebarStatusFn } from "@/web/functions/dashboard.functions";
import { deployProjectFn } from "@/web/functions/deployments.functions";
import { listProjectsFn } from "@/web/functions/projects.functions";
import type { SessionUser } from "@/web/functions/session.functions";

import { authClient } from "./auth-client";
import { NelcotaMark } from "./brand-logo";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { useDeploymentNotifications } from "./deployment-notifications";
import { ROLE_LABELS } from "./labels";
import { MAIN_AREAS, PROJECT_SECTIONS, SETTINGS_SECTIONS } from "./navigation";
import { projectQueryOptions } from "./project-query";
import { useTheme } from "./theme";
import { Button } from "./ui/button";
import { cn } from "./ui/class-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useAction } from "./use-action";
import { useCan } from "./use-permissions";

const NAV_LINK =
  "group flex h-10 items-center gap-3 rounded-lg px-3 text-base text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-foreground";
const NAV_ICON = "size-5 shrink-0 group-data-[status=active]:text-brand";
const STATUS_POLL_INTERVAL_IN_MS = 10_000;

type NavigateProps = { readonly onNavigate?: (() => void) | undefined };

function projectsQuery() {
  return { queryKey: ["projects", ""], queryFn: () => listProjectsFn({ data: { search: "" } }) };
}

function sidebarStatusQuery() {
  return {
    queryKey: ["sidebar-status"],
    queryFn: () => getSidebarStatusFn(),
    refetchInterval: STATUS_POLL_INTERVAL_IN_MS,
  };
}

/** Project id of the current route, or null outside a project. */
function useCurrentProjectId(): string | null {
  const params = useParams({ strict: false });
  return typeof params.projectId === "string" ? params.projectId : null;
}

function usePathname(): string {
  return useRouterState({ select: (state) => state.location.pathname });
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function StatusDot({
  online,
  className,
}: {
  readonly online: boolean;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        online ? "bg-success" : "bg-muted-foreground/40",
        className,
      )}
    />
  );
}

function CountBadge({
  value,
  tone = "neutral",
}: {
  readonly value: number;
  readonly tone?: "neutral" | "active";
}) {
  return (
    <span
      className={cn(
        "ml-auto min-w-6 rounded-md px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums",
        tone === "active"
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

function SectionTitle({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-8 items-center px-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{children}</h2>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sidebar sections                                                           */
/* -------------------------------------------------------------------------- */

function SearchButton({ onSearch }: { readonly onSearch: () => void }) {
  return (
    <button
      type="button"
      onClick={onSearch}
      aria-label="Buscar projetos e páginas"
      className="flex h-10 shrink-0 items-center gap-3 rounded-lg border bg-surface px-3 text-base whitespace-nowrap text-muted-foreground transition-colors hover:border-input hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none sm:w-80"
    >
      <SearchIcon aria-hidden className="size-[1.125rem]" />
      <span className="hidden sm:inline">Buscar…</span>
      <kbd className="ml-auto hidden rounded-md border bg-surface-sunken px-1.5 py-0.5 font-mono text-xs whitespace-nowrap sm:inline">
        Ctrl K
      </kbd>
    </button>
  );
}

/**
 * Header of the context panel: the open project (or the platform) with its status, and a
 * menu to jump to any project.
 */
function ContextSwitcher({ onNavigate }: NavigateProps) {
  const projectId = useCurrentProjectId();
  const projects = useQuery(projectsQuery());
  const current = projects.data?.find((project) => project.id === projectId) ?? null;
  const online = current?.containerState === "running";
  const count = projects.data?.length ?? 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-full w-full items-center gap-3 px-5 text-left transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:ring-inset"
        >
          <FolderIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold">
              {current?.name ?? "Nelcota Deploy"}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {current == null ? null : <StatusDot online={online} className="size-2" />}
              <span className="truncate">
                {current == null
                  ? `${count} ${count === 1 ? "projeto" : "projetos"}`
                  : current.repositoryFullName}
              </span>
            </span>
          </span>
          <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Projetos</DropdownMenuLabel>
        {(projects.data ?? []).map((project) => (
          <DropdownMenuItem key={project.id} asChild>
            <Link to="/projects/$projectId" params={{ projectId: project.id }} onClick={onNavigate}>
              <StatusDot online={project.containerState === "running"} className="size-2" />
              <span className="truncate">{project.name}</span>
              {project.id === projectId ? <CheckIcon aria-hidden className="ml-auto" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/projects" onClick={onNavigate}>
            <BoxesIcon aria-hidden />
            Todos os projetos
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/projects/new" onClick={onNavigate}>
            <PlusIcon aria-hidden />
            Novo projeto
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A sidebar entry: a link, or a collapsible group of links. */
type NavItem = {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly link?: Pick<LinkComponentProps, "to" | "params" | "search" | "activeOptions">;
  readonly badge?: ReactNode;
  readonly children?: readonly NavItem[];
  /** Groups start expanded unless this is false. */
  readonly defaultOpen?: boolean;
};

const SUB_LINK =
  "group flex min-h-9 items-center gap-3 rounded-lg px-3 py-1.5 text-[0.9375rem] leading-snug text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-foreground";

function NavLeaf({
  item,
  sub,
  onNavigate,
}: { readonly item: NavItem; readonly sub: boolean } & NavigateProps) {
  return (
    <Link {...item.link} onClick={onNavigate} className={sub ? SUB_LINK : NAV_LINK}>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          sub ? "size-[1.125rem]" : "size-5",
        )}
      >
        {item.icon}
      </span>
      <span className="min-w-0 flex-1">{item.label}</span>
      {item.badge}
    </Link>
  );
}

/** Path a nav link points to, with its params filled in, for "is this group current?" checks. */
function itemPath(item: NavItem): string | null {
  const to = item.link?.to;
  if (typeof to !== "string") {
    return null;
  }
  const params = item.link?.params;
  const projectId =
    typeof params === "object" && params != null && "projectId" in params
      ? String(params.projectId)
      : "";
  return to.replace("$projectId", projectId);
}

function useGroupHoldsCurrentPage(item: NavItem): boolean {
  const pathname = usePathname();
  const search = useSearch({ strict: false });
  return (item.children ?? []).some((child) => {
    const path = itemPath(child);
    if (path == null || pathname.startsWith(path) === false) {
      return false;
    }
    const childSearch = child.link?.search;
    if (typeof childSearch !== "object" || childSearch == null || "tab" in childSearch === false) {
      return true;
    }
    return (
      search.tab === childSearch.tab || (search.tab == null && childSearch.tab === "organization")
    );
  });
}

function NavGroup({ item, onNavigate }: { readonly item: NavItem } & NavigateProps) {
  const holdsCurrentPage = useGroupHoldsCurrentPage(item);
  const [open, setOpen] = useState(holdsCurrentPage || item.defaultOpen === true);
  useEffect(() => {
    // Navigating into a page of a collapsed group reveals where you are.
    if (holdsCurrentPage) {
      setOpen(true);
    }
  }, [holdsCurrentPage]);
  const children = item.children ?? [];
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => current === false)}
        className={cn(NAV_LINK, "w-full text-left")}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">{item.icon}</span>
        <span className="min-w-0 flex-1">{item.label}</span>
        {item.badge}
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open ? "rotate-90" : "",
          )}
        />
      </button>
      {open ? (
        <div className="mt-1 mb-2 ml-[1.375rem] space-y-0.5 border-l border-sidebar-border pl-3">
          {children.map((child) => (
            <NavLeaf key={child.key} item={child} sub onNavigate={onNavigate} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NavTree({ items, onNavigate }: { readonly items: readonly NavItem[] } & NavigateProps) {
  return (
    <div className="space-y-1">
      {items.map((item) =>
        item.children == null ? (
          <NavLeaf key={item.key} item={item} sub={false} onNavigate={onNavigate} />
        ) : (
          <NavGroup key={item.key} item={item} onNavigate={onNavigate} />
        ),
      )}
    </div>
  );
}

function icon(Icon: LucideIcon, sub = false) {
  return <Icon aria-hidden className={cn(sub ? "size-[1.125rem]" : NAV_ICON, "shrink-0")} />;
}

function administrationItem(permissions: readonly string[]): NavItem {
  return {
    key: "administration",
    label: "Administração",
    icon: icon(ShieldCheckIcon),
    children: SETTINGS_SECTIONS.filter(
      (section) => section.permission == null || permissions.includes(section.permission),
    ).map((section) => ({
      key: `settings-${section.tab}`,
      label: section.label,
      icon: icon(section.icon, true),
      link: {
        to: "/settings",
        search: { tab: section.tab },
        activeOptions: { includeSearch: true },
      },
    })),
  };
}

/** Navigation on global pages: areas, the project list and administration. */
function GlobalNavigation({ user, onNavigate }: { readonly user: SessionUser } & NavigateProps) {
  const projects = useQuery(projectsQuery());
  const status = useQuery(sidebarStatusQuery());
  const activeDeployments = status.data?.activeDeployments ?? 0;
  const list = projects.data ?? [];
  const projectChildren: NavItem[] = list.map((project) => ({
    key: project.id,
    label: project.name,
    icon: <StatusDot online={project.containerState === "running"} />,
    link: { to: "/projects/$projectId", params: { projectId: project.id } },
  }));
  projectChildren.push({
    key: "all-projects",
    label: "Todos os projetos",
    icon: icon(LayoutListIcon, true),
    link: { to: "/projects", activeOptions: { exact: true } },
  });
  if (user.permissions.includes("project:write")) {
    projectChildren.push({
      key: "new-project",
      label: "Novo projeto",
      icon: icon(PlusIcon, true),
      link: { to: "/projects/new" },
    });
  }
  const items: NavItem[] = [
    {
      key: "dashboard",
      label: "Painel",
      icon: icon(HomeIcon),
      link: { to: "/", activeOptions: { exact: true } },
    },
    {
      key: "projects",
      label: "Projetos",
      icon: icon(BoxesIcon),
      badge: projects.data == null ? null : <CountBadge value={list.length} />,
      children: projectChildren,
    },
    {
      key: "deployments",
      label: "Deploys",
      icon: icon(RocketIcon),
      link: { to: "/deployments" },
      badge: activeDeployments > 0 ? <CountBadge value={activeDeployments} tone="active" /> : null,
    },
  ];
  return (
    <>
      <section className="space-y-1">
        <SectionTitle>Visão geral</SectionTitle>
        <NavTree items={items} onNavigate={onNavigate} />
      </section>
      <PanelDivider />
      <NavTree items={[administrationItem(user.permissions)]} onNavigate={onNavigate} />
    </>
  );
}

function PanelDivider() {
  return <div aria-hidden className="mx-3 h-px bg-sidebar-border" />;
}

/** Navigation inside a project: its pages grouped by purpose, then a way back. */
function ProjectNavigation({
  projectId,
  user,
  onNavigate,
}: { readonly projectId: string; readonly user: SessionUser } & NavigateProps) {
  const params = { projectId };
  const items: NavItem[] = [
    {
      key: "overview",
      label: "Visão geral",
      icon: icon(HomeIcon),
      link: { to: "/projects/$projectId", params, activeOptions: { exact: true } },
    },
    {
      key: "deployments",
      label: "Deploys",
      icon: icon(RocketIcon),
      link: { to: "/projects/$projectId/deployments", params },
    },
    {
      key: "observability",
      label: "Observabilidade",
      icon: icon(GaugeIcon),
      children: [
        {
          key: "logs",
          label: "Logs",
          icon: icon(ScrollTextIcon, true),
          link: { to: "/projects/$projectId/logs", params },
        },
        {
          key: "metrics",
          label: "Métricas",
          icon: icon(ActivityIcon, true),
          link: { to: "/projects/$projectId/metrics", params },
        },
      ],
    },
    {
      key: "configuration",
      label: "Configuração",
      icon: icon(SlidersHorizontalIcon),
      children: [
        {
          key: "environment",
          label: "Variáveis",
          icon: icon(VariableIcon, true),
          link: { to: "/projects/$projectId/environment", params },
        },
        {
          key: "domains",
          label: "Domínios",
          icon: icon(GlobeIcon, true),
          link: { to: "/projects/$projectId/domains", params },
        },
        {
          key: "settings",
          label: "Ajustes do projeto",
          icon: icon(SettingsIcon, true),
          link: { to: "/projects/$projectId/settings", params },
        },
      ],
    },
    {
      key: "tasks",
      label: "Tasks",
      icon: icon(ClockIcon),
      link: { to: "/projects/$projectId/tasks", params },
    },
  ];
  const general: NavItem[] = [
    {
      key: "projects",
      label: "Todos os projetos",
      icon: icon(BoxesIcon),
      link: { to: "/projects", activeOptions: { exact: true } },
    },
    {
      key: "all-deployments",
      label: "Deploys",
      icon: icon(RocketIcon),
      link: { to: "/deployments" },
    },
    administrationItem(user.permissions),
  ];
  return (
    <>
      <section className="space-y-1">
        <SectionTitle>Projeto</SectionTitle>
        <NavTree items={items} onNavigate={onNavigate} />
      </section>
      <PanelDivider />
      <NavTree items={general} onNavigate={onNavigate} />
    </>
  );
}

function WorkerStatusRow() {
  const status = useQuery(sidebarStatusQuery());
  const worker = status.data?.worker ?? null;
  const healthy = worker?.online === true && worker.dockerAvailable;
  let label = "Worker offline";
  if (healthy) {
    label = "Worker e Docker online";
  } else if (worker?.online === true) {
    label = "Docker indisponível";
  }
  return (
    <Link
      to="/settings"
      search={{ tab: "server" }}
      className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <span className="flex size-5 items-center justify-center">
        <StatusDot online={healthy} />
      </span>
      <span className="min-w-0 truncate text-sm font-medium">{label}</span>
    </Link>
  );
}

function AccountMenu({
  user,
  compact = false,
}: {
  readonly user: SessionUser;
  readonly compact?: boolean;
}) {
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const signOut = async () => {
    const result = await authClient.signOut();
    if (result.error != null) {
      toast.error("Não foi possível sair. Tente novamente.");
      return;
    }
    await router.navigate({ to: "/login" });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={compact ? `Conta de ${user.name}` : undefined}
          className={cn(
            "flex items-center gap-3 rounded-lg text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
            compact ? "p-1" : "w-full px-2 py-2",
          )}
        >
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
          >
            {initialsOf(user.name)}
          </span>
          <span className={cn("min-w-0 flex-1", compact ? "hidden" : "")}>
            <span className="block truncate text-base font-semibold">{user.name}</span>
            <span className="block truncate text-sm text-muted-foreground">
              {ROLE_LABELS[user.role]}
            </span>
          </span>
          {compact ? null : (
            <ChevronsUpDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={compact ? "right" : "top"}
        align={compact ? "end" : "start"}
        className="w-64"
      >
        <DropdownMenuLabel className="font-normal">
          <p className="truncate font-semibold">{user.name}</p>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={toggleTheme}>
          {theme === "dark" ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
          {theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOutIcon aria-hidden />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const RAIL_LINK =
  "flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none data-[status=active]:bg-sidebar-accent data-[status=active]:text-foreground";

function RailTooltip({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function WorkerStatusIcon() {
  const status = useQuery(sidebarStatusQuery());
  const worker = status.data?.worker ?? null;
  const healthy = worker?.online === true && worker.dockerAvailable;
  let label = "Worker offline";
  if (healthy) {
    label = `Worker e Docker online${worker.dockerVersion == null ? "" : ` · Docker ${worker.dockerVersion}`}`;
  } else if (worker?.online === true) {
    label = "Worker online · Docker indisponível";
  }
  return (
    <RailTooltip label={label}>
      <Link to="/settings" search={{ tab: "server" }} aria-label={label} className={RAIL_LINK}>
        <span className="relative">
          <ServerIcon aria-hidden className="size-5" />
          <StatusDot
            online={healthy}
            className="absolute -right-1 -bottom-1 size-2.5 ring-2 ring-sidebar"
          />
        </span>
      </Link>
    </RailTooltip>
  );
}

function ThemeButton() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "Usar tema claro" : "Usar tema escuro";
  return (
    <RailTooltip label={label}>
      <button type="button" aria-label={label} onClick={toggleTheme} className={RAIL_LINK}>
        {theme === "dark" ? (
          <SunIcon aria-hidden className="size-5" />
        ) : (
          <MoonIcon aria-hidden className="size-5" />
        )}
      </button>
    </RailTooltip>
  );
}

/** Narrow column with the logo, the main areas and the account. */
function Rail({ user }: { readonly user: SessionUser }) {
  return (
    <div className="hidden w-[4.5rem] shrink-0 flex-col items-center justify-between bg-sidebar py-4 lg:flex">
      <div className="flex flex-col items-center gap-6">
        <Link
          to="/"
          aria-label="Nelcota Deploy — Painel"
          className="flex size-12 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <NelcotaMark className="h-8 w-auto" />
        </Link>
        <nav aria-label="Áreas" className="flex flex-col items-center gap-1.5">
          {MAIN_AREAS.map((area) => (
            <RailTooltip key={area.to} label={area.label}>
              <Link
                to={area.to}
                activeOptions={{ exact: area.exact }}
                aria-label={area.label}
                className={RAIL_LINK}
              >
                <area.icon aria-hidden className="size-5" />
              </Link>
            </RailTooltip>
          ))}
        </nav>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <WorkerStatusIcon />
        <ThemeButton />
        <AccountMenu user={user} compact />
      </div>
    </div>
  );
}

/** The current context: switcher on top, then the pages of the project or of the platform. */
function ContextPanel({ user, onNavigate }: { readonly user: SessionUser } & NavigateProps) {
  const projectId = useCurrentProjectId();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="h-16 shrink-0 border-b border-sidebar-border">
        <ContextSwitcher onNavigate={onNavigate} />
      </div>
      <nav
        aria-label="Navegação da seção"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-5"
      >
        {projectId == null ? (
          <GlobalNavigation user={user} onNavigate={onNavigate} />
        ) : (
          <ProjectNavigation projectId={projectId} user={user} onNavigate={onNavigate} />
        )}
      </nav>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Top bar                                                                    */
/* -------------------------------------------------------------------------- */

type Crumb = { readonly label: string; readonly link?: ReactNode };

const SHORT_ID_LENGTH = 8;

function deploymentCrumbs(
  projectId: string,
  section: (typeof PROJECT_SECTIONS)[number],
  deploymentId: string | null,
): Crumb[] {
  if (deploymentId == null) {
    return [{ label: section.label }];
  }
  return [
    {
      label: "Deploys",
      link: (
        <Link to="/projects/$projectId/deployments" params={{ projectId }}>
          Deploys
        </Link>
      ),
    },
    { label: `Deploy ${deploymentId.replaceAll("-", "").slice(-SHORT_ID_LENGTH)}` },
  ];
}

function useBreadcrumb(): Crumb[] {
  const params = useParams({ strict: false });
  const deploymentId = typeof params.deploymentId === "string" ? params.deploymentId : null;
  const pathname = usePathname();
  const search = useSearch({ strict: false });
  const projectId = useCurrentProjectId();
  const projects = useQuery(projectsQuery());
  if (projectId != null) {
    const name = projects.data?.find((project) => project.id === projectId)?.name ?? "Projeto";
    const suffix = pathname.slice(`/projects/${projectId}`.length);
    const section =
      PROJECT_SECTIONS.find((item) => {
        const itemSuffix = item.to.slice("/projects/$projectId".length);
        return itemSuffix !== "" && suffix.startsWith(itemSuffix);
      }) ?? PROJECT_SECTIONS[0];
    return [
      { label: "Projetos", link: <Link to="/projects">Projetos</Link> },
      {
        label: name,
        link: (
          <Link to="/projects/$projectId" params={{ projectId }}>
            {name}
          </Link>
        ),
      },
      ...deploymentCrumbs(projectId, section, deploymentId),
    ];
  }
  if (pathname.startsWith("/settings")) {
    const tab = typeof search.tab === "string" ? search.tab : "organization";
    const label = SETTINGS_SECTIONS.find((section) => section.tab === tab)?.label ?? "Organização";
    return [{ label: "Administração" }, { label }];
  }
  if (pathname === "/projects/new") {
    return [
      { label: "Projetos", link: <Link to="/projects">Projetos</Link> },
      { label: "Novo projeto" },
    ];
  }
  const area = MAIN_AREAS.find((item) =>
    item.exact ? pathname === item.to : pathname.startsWith(item.to),
  );
  return [{ label: area?.label ?? "Painel" }];
}

function Breadcrumb() {
  const crumbs = useBreadcrumb();
  return (
    <nav aria-label="Você está em" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-base">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li
              key={`${crumb.label}-${index}`}
              className={cn("min-w-0 items-center gap-1.5", last ? "flex" : "hidden sm:flex")}
            >
              {index > 0 ? (
                <ChevronRightIcon
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground/60",
                    last ? "hidden sm:block" : "",
                  )}
                />
              ) : null}
              {last ? (
                <span aria-current="page" className="truncate font-semibold">
                  {crumb.label}
                </span>
              ) : (
                <span className="truncate text-muted-foreground transition-colors hover:text-foreground">
                  {crumb.link ?? crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Deploy button in the top bar on every project page except the overview, which has its own. */
function ProjectQuickDeploy() {
  const projectId = useCurrentProjectId();
  const pathname = usePathname();
  const can = useCan();
  const navigate = useNavigate();
  const project = useQuery({ ...projectQueryOptions(projectId ?? ""), enabled: projectId != null });
  const deploy = useAction({
    action: () => deployProjectFn({ data: { projectId: projectId ?? "" } }),
    successMessage: (result) =>
      result.created ? "Deploy colocado na fila" : "Já existe um deploy igual na fila",
    invalidate: [["project", projectId], ["deployments"]],
    onSuccess: async (result) => {
      await navigate({
        to: "/projects/$projectId/deployments/$deploymentId",
        params: { projectId: projectId ?? "", deploymentId: result.deploymentId },
      });
    },
  });
  const onOverview = projectId != null && pathname === `/projects/${projectId}`;
  const approved = project.data?.project.deploymentsApproved === true;
  if (projectId == null || onOverview || approved === false || can("deployment:create") === false) {
    return null;
  }
  return (
    <Button size="sm" disabled={deploy.isPending} onClick={() => deploy.mutate()}>
      <RocketIcon aria-hidden />
      <span className="hidden sm:inline">Deploy</span>
    </Button>
  );
}

function MobileMenu({ user }: { readonly user: SessionUser }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Abrir menu" className="lg:hidden">
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 gap-0 bg-panel p-0">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <nav
          aria-label="Áreas"
          className="grid grid-cols-4 gap-1 border-b border-sidebar-border p-3"
        >
          {MAIN_AREAS.map((area) => (
            <Link
              key={area.to}
              to={area.to}
              activeOptions={{ exact: area.exact }}
              onClick={() => setOpen(false)}
              className="flex flex-col items-center gap-1 rounded-lg py-2 text-xs text-muted-foreground hover:bg-sidebar-accent data-[status=active]:bg-sidebar-accent data-[status=active]:text-foreground"
            >
              <area.icon aria-hidden className="size-5" />
              {area.label}
            </Link>
          ))}
        </nav>
        <ContextPanel user={user} onNavigate={() => setOpen(false)} />
        <div className="space-y-1 border-t border-sidebar-border p-3">
          <WorkerStatusRow />
          <AccountMenu user={user} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Application frame: an icon rail (areas, worker status, theme, account), a context panel
 * (project switcher and the pages of the current project or of the platform) and a top bar.
 */
export function AppShell({
  user,
  children,
}: {
  readonly user: SessionUser;
  readonly children: ReactNode;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  useCommandPaletteShortcut(() => setSearchOpen(true));
  useDeploymentNotifications();
  const openSearch = () => setSearchOpen(true);
  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Pular para o conteúdo
      </a>
      <Rail user={user} />
      <aside className="hidden w-64 shrink-0 flex-col border-x border-sidebar-border bg-panel lg:flex">
        <ContextPanel user={user} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border px-4 md:px-8">
          <MobileMenu user={user} />
          <Breadcrumb />
          <div className="ml-auto flex items-center gap-2">
            <ProjectQuickDeploy />
            <SearchButton onSearch={openSearch} />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto focus:outline-none">
          <div className="mx-auto max-w-[88rem] space-y-8 px-5 py-8 md:px-10 md:py-10">
            {children}
          </div>
        </main>
      </div>
      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        permissions={user.permissions}
      />
    </div>
  );
}
