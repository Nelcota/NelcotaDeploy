import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouter, useRouterState, useSearch } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  SunIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { getSidebarStatusFn } from "@/web/functions/dashboard.functions";
import { listProjectsFn } from "@/web/functions/projects.functions";
import type { SessionUser } from "@/web/functions/session.functions";

import { authClient } from "./auth-client";
import { NelcotaLogo } from "./brand-logo";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { ROLE_LABELS } from "./labels";
import { MAIN_AREAS, PROJECT_SECTIONS, SETTINGS_SECTIONS } from "./navigation";
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
import { Skeleton } from "./ui/skeleton";

const NAV_LINK =
  "group flex h-10 items-center gap-3 rounded-lg px-3 text-base text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-foreground";
const NAV_ICON = "size-5 shrink-0 group-data-[status=active]:text-brand";
const STATUS_POLL_INTERVAL_IN_MS = 10_000;
const RECENT_PROJECT_LIMIT = 6;

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
      className="flex h-10 w-full items-center gap-3 rounded-lg border bg-surface px-3 text-base text-muted-foreground transition-colors hover:border-input hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <SearchIcon aria-hidden className="size-[1.125rem]" />
      Buscar
      <kbd className="ml-auto rounded-md border bg-surface-sunken px-1.5 py-0.5 font-mono text-xs">
        Ctrl K
      </kbd>
    </button>
  );
}

function MainNavigation({ onNavigate }: NavigateProps) {
  const projects = useQuery(projectsQuery());
  const status = useQuery(sidebarStatusQuery());
  const activeDeployments = status.data?.activeDeployments ?? 0;
  const [dashboard, projectsArea, deploymentsArea] = MAIN_AREAS;
  return (
    <div className="space-y-1">
      {[dashboard, projectsArea, deploymentsArea].map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: item.exact }}
          onClick={onNavigate}
          className={NAV_LINK}
        >
          <item.icon aria-hidden className={NAV_ICON} />
          {item.label}
          {item === projectsArea && projects.data != null ? (
            <CountBadge value={projects.data.length} />
          ) : null}
          {item === deploymentsArea && activeDeployments > 0 ? (
            <CountBadge value={activeDeployments} tone="active" />
          ) : null}
        </Link>
      ))}
    </div>
  );
}

function ProjectSwitcher({
  projectId,
  onNavigate,
}: { readonly projectId: string } & NavigateProps) {
  const projects = useQuery(projectsQuery());
  const current = projects.data?.find((project) => project.id === projectId) ?? null;
  const online = current?.containerState === "running";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-raised focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-foreground">
            {initialsOf(current?.name ?? "?")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold">
              {current?.name ?? "Projeto"}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <StatusDot online={online} className="size-2" />
              <span className="truncate">{online ? "Online" : "Offline"}</span>
            </span>
          </span>
          <ChevronsUpDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Trocar de projeto
        </DropdownMenuLabel>
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
          <Link to="/projects/new" onClick={onNavigate}>
            <PlusIcon aria-hidden />
            Novo projeto
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectNavigation({
  projectId,
  onNavigate,
}: { readonly projectId: string } & NavigateProps) {
  return (
    <section className="space-y-2">
      <SectionTitle>Projeto</SectionTitle>
      <ProjectSwitcher projectId={projectId} onNavigate={onNavigate} />
      <div className="space-y-1 pt-1">
        {PROJECT_SECTIONS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            params={{ projectId }}
            activeOptions={{ exact: item.exact }}
            onClick={onNavigate}
            className={NAV_LINK}
          >
            <item.icon aria-hidden className={NAV_ICON} />
            {item.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

function RecentProjects({
  canCreate,
  onNavigate,
}: { readonly canCreate: boolean } & NavigateProps) {
  const projects = useQuery(projectsQuery());
  const list = projects.data ?? [];
  return (
    <section className="space-y-1">
      <SectionTitle>Projetos</SectionTitle>
      {projects.isPending ? <Skeleton className="mx-3 h-9" /> : null}
      {list.slice(0, RECENT_PROJECT_LIMIT).map((project) => (
        <Link
          key={project.id}
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          onClick={onNavigate}
          className={NAV_LINK}
        >
          <span className="flex size-5 items-center justify-center">
            <StatusDot online={project.containerState === "running"} />
          </span>
          <span className="truncate">{project.name}</span>
        </Link>
      ))}
      {list.length > RECENT_PROJECT_LIMIT ? (
        <Link to="/projects" onClick={onNavigate} className={cn(NAV_LINK, "text-sm")}>
          <span className="size-5" />
          Ver todos os {list.length} projetos
        </Link>
      ) : null}
      {projects.isSuccess && list.length === 0 ? (
        <p className="px-3 py-1 text-sm text-muted-foreground">Nenhum projeto ainda.</p>
      ) : null}
      {canCreate ? (
        <Link to="/projects/new" onClick={onNavigate} className={NAV_LINK}>
          <PlusIcon aria-hidden className={NAV_ICON} />
          Novo projeto
        </Link>
      ) : null}
    </section>
  );
}

function AdministrationNavigation({
  permissions,
  onNavigate,
}: { readonly permissions: readonly string[] } & NavigateProps) {
  const pathname = usePathname();
  const search = useSearch({ strict: false });
  const onSettings = pathname.startsWith("/settings");
  const currentTab = typeof search.tab === "string" ? search.tab : "organization";
  const sections = SETTINGS_SECTIONS.filter(
    (section) => section.permission == null || permissions.includes(section.permission),
  );
  if (onSettings === false) {
    return (
      <section className="space-y-1">
        <SectionTitle>Sistema</SectionTitle>
        <Link to="/settings" onClick={onNavigate} className={NAV_LINK}>
          <ShieldCheckIcon aria-hidden className={NAV_ICON} />
          Administração
        </Link>
      </section>
    );
  }
  return (
    <section className="space-y-1">
      <SectionTitle>Administração</SectionTitle>
      {sections.map((section) => (
        <Link
          key={section.tab}
          to="/settings"
          search={{ tab: section.tab }}
          onClick={onNavigate}
          data-status={onSettings && section.tab === currentTab ? "active" : undefined}
          className={NAV_LINK}
        >
          <section.icon aria-hidden className={NAV_ICON} />
          {section.label}
        </Link>
      ))}
    </section>
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

function AccountMenu({ user }: { readonly user: SessionUser }) {
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
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
          >
            {initialsOf(user.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold">{user.name}</span>
            <span className="block truncate text-sm text-muted-foreground">
              {ROLE_LABELS[user.role]}
            </span>
          </span>
          <ChevronsUpDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)]"
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

/** Everything inside the sidebar; shared by the desktop sidebar and the mobile drawer. */
function SidebarContent({
  user,
  onSearch,
  onNavigate,
}: { readonly user: SessionUser; readonly onSearch: () => void } & NavigateProps) {
  const projectId = useCurrentProjectId();
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-5 px-3 pt-5">
        <Link
          to="/"
          onClick={onNavigate}
          aria-label="Nelcota Deploy — Painel"
          className="flex items-center gap-2.5 px-2 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <NelcotaLogo className="h-7 w-auto text-foreground" />
          <span className="text-lg font-medium text-muted-foreground">Deploy</span>
        </Link>
        <SearchButton onSearch={onSearch} />
      </div>
      <nav aria-label="Navegação principal" className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        <MainNavigation onNavigate={onNavigate} />
        {projectId == null ? (
          <RecentProjects
            canCreate={user.permissions.includes("project:write")}
            onNavigate={onNavigate}
          />
        ) : (
          <ProjectNavigation projectId={projectId} onNavigate={onNavigate} />
        )}
        <AdministrationNavigation permissions={user.permissions} onNavigate={onNavigate} />
      </nav>
      <div className="space-y-1 border-t border-sidebar-border px-3 py-3">
        <WorkerStatusRow />
        <AccountMenu user={user} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Top bar                                                                    */
/* -------------------------------------------------------------------------- */

type Crumb = { readonly label: string; readonly link?: ReactNode };

function useBreadcrumb(): Crumb[] {
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
      { label: section.label },
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
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? (
                <ChevronRightIcon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground/60"
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

function MobileMenu({
  user,
  onSearch,
}: {
  readonly user: SessionUser;
  readonly onSearch: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Abrir menu" className="lg:hidden">
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 gap-0 p-0">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <SidebarContent
          user={user}
          onNavigate={() => setOpen(false)}
          onSearch={() => {
            setOpen(false);
            onSearch();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Application frame: one sidebar (areas, current project or recent projects, administration,
 * worker status and account) and a top bar with the breadcrumb.
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
  const openSearch = () => setSearchOpen(true);
  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <aside className="hidden w-72 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarContent user={user} onSearch={openSearch} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border px-4 md:px-8">
          <MobileMenu user={user} onSearch={openSearch} />
          <Breadcrumb />
        </header>
        <main id="main" className="flex-1 overflow-y-auto">
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
