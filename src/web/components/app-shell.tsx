import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouter, useRouterState, useSearch } from "@tanstack/react-router";
import {
  BoxesIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  HomeIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  PlusIcon,
  RocketIcon,
  SearchIcon,
  SunIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { getWorkerStatusFn } from "@/web/functions/dashboard.functions";
import { listProjectsFn } from "@/web/functions/projects.functions";
import type { SessionUser } from "@/web/functions/session.functions";

import { authClient } from "./auth-client";
import { NelcotaLogo, NelcotaMark } from "./brand-logo";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { ROLE_LABELS } from "./labels";
import { PROJECT_SECTIONS, RAIL_ITEMS, SETTINGS_SECTIONS } from "./navigation";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const SIDEBAR_LINK =
  "group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-foreground";
const SIDEBAR_ICON = "size-4 shrink-0 group-data-[status=active]:text-brand";

/** Project id of the current route, or null outside a project. */
function projectsQuery() {
  return { queryKey: ["projects", ""], queryFn: () => listProjectsFn({ data: { search: "" } }) };
}

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

/* -------------------------------------------------------------------------- */
/* Icon rail                                                                  */
/* -------------------------------------------------------------------------- */

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "Usar tema claro" : "Usar tema escuro";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={toggleTheme}>
          {theme === "dark" ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function IconRail() {
  return (
    <div className="hidden w-[4.5rem] shrink-0 flex-col items-center justify-between border-r border-sidebar-border bg-sidebar py-4 lg:flex">
      <div className="flex flex-col items-center">
        <Link
          to="/"
          aria-label="Nelcota Deploy — Painel"
          className="flex size-12 items-center justify-center rounded-lg focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none"
        >
          <NelcotaMark className="h-8 w-auto" />
        </Link>
        <nav aria-label="Áreas" className="mt-6 flex flex-col items-center gap-1.5">
          {RAIL_ITEMS.map((item) => (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>
                <Link
                  to={item.to}
                  activeOptions={{ exact: item.exact }}
                  aria-label={item.label}
                  className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none data-[status=active]:bg-sidebar-accent data-[status=active]:text-foreground"
                >
                  <item.icon aria-hidden className="size-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ))}
        </nav>
      </div>
      <ThemeToggleButton />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Context sidebar                                                            */
/* -------------------------------------------------------------------------- */

function SidebarSection({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex h-7 items-center justify-between px-2.5">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function StatusDot({ online }: { readonly online: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        online ? "bg-success" : "bg-muted-foreground/50",
      )}
    />
  );
}

type NavigateProps = { readonly onNavigate?: (() => void) | undefined };

function ProjectNavigation({
  projectId,
  onNavigate,
}: { readonly projectId: string } & NavigateProps) {
  const projects = useQuery(projectsQuery());
  const project = projects.data?.find((candidate) => candidate.id === projectId) ?? null;
  return (
    <>
      <Link
        to="/projects"
        onClick={onNavigate}
        className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <ChevronLeftIcon aria-hidden className="size-4" />
        Projetos
      </Link>
      <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-3">
        <StatusDot online={project?.containerState === "running"} />
        <span className="truncate font-semibold">{project?.name ?? "Projeto"}</span>
      </div>
      <SidebarSection title="Projeto">
        {PROJECT_SECTIONS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            params={{ projectId }}
            activeOptions={{ exact: item.exact }}
            onClick={onNavigate}
            className={SIDEBAR_LINK}
          >
            <item.icon aria-hidden className={SIDEBAR_ICON} />
            {item.label}
          </Link>
        ))}
      </SidebarSection>
    </>
  );
}

function SettingsNavigation({
  permissions,
  onNavigate,
}: { readonly permissions: readonly string[] } & NavigateProps) {
  const search = useSearch({ strict: false });
  const currentTab = typeof search.tab === "string" ? search.tab : "organization";
  return (
    <SidebarSection title="Configurações">
      {SETTINGS_SECTIONS.filter(
        (section) => section.permission == null || permissions.includes(section.permission),
      ).map((section) => (
        <Link
          key={section.tab}
          to="/settings"
          search={{ tab: section.tab }}
          onClick={onNavigate}
          data-status={section.tab === currentTab ? "active" : undefined}
          className={SIDEBAR_LINK}
        >
          <section.icon aria-hidden className={SIDEBAR_ICON} />
          {section.label}
        </Link>
      ))}
    </SidebarSection>
  );
}

const SIDEBAR_PROJECT_LIMIT = 8;

/** Global pages plus the project list, so any project is one click away. */
function OverviewNavigation({
  canCreate,
  onNavigate,
}: { readonly canCreate: boolean } & NavigateProps) {
  const projects = useQuery(projectsQuery());
  const list = projects.data ?? [];
  return (
    <>
      <SidebarSection title="Visão geral">
        <Link to="/" activeOptions={{ exact: true }} onClick={onNavigate} className={SIDEBAR_LINK}>
          <HomeIcon aria-hidden className={SIDEBAR_ICON} />
          Painel
        </Link>
        <Link to="/deployments" onClick={onNavigate} className={SIDEBAR_LINK}>
          <RocketIcon aria-hidden className={SIDEBAR_ICON} />
          Deploys
        </Link>
      </SidebarSection>
      <SidebarSection
        title="Projetos"
        action={
          canCreate ? (
            <Link
              to="/projects/new"
              onClick={onNavigate}
              aria-label="Novo projeto"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <PlusIcon aria-hidden className="size-4" />
            </Link>
          ) : null
        }
      >
        {projects.isPending ? <Skeleton className="mx-2.5 h-8" /> : null}
        {list.slice(0, SIDEBAR_PROJECT_LIMIT).map((project) => (
          <Link
            key={project.id}
            to="/projects/$projectId"
            params={{ projectId: project.id }}
            onClick={onNavigate}
            className={SIDEBAR_LINK}
          >
            <StatusDot online={project.containerState === "running"} />
            <span className="truncate">{project.name}</span>
          </Link>
        ))}
        {projects.isSuccess && list.length === 0 ? (
          <p className="px-2.5 py-1.5 text-sm text-muted-foreground">Nenhum projeto ainda.</p>
        ) : null}
        <Link
          to="/projects"
          activeOptions={{ exact: true }}
          onClick={onNavigate}
          className={SIDEBAR_LINK}
        >
          <BoxesIcon aria-hidden className={SIDEBAR_ICON} />
          {list.length > SIDEBAR_PROJECT_LIMIT ? `Ver todos (${list.length})` : "Todos os projetos"}
        </Link>
      </SidebarSection>
    </>
  );
}

const WORKER_POLL_INTERVAL_IN_MS = 15_000;

/** Real worker and Docker state, so a stopped worker is noticed from any page. */
function WorkerStatus() {
  const worker = useQuery({
    queryKey: ["worker-status"],
    queryFn: () => getWorkerStatusFn(),
    refetchInterval: WORKER_POLL_INTERVAL_IN_MS,
  });
  const status = worker.data;
  const online = status?.online === true;
  let detail = "Nunca conectou";
  if (status != null) {
    detail = status.dockerAvailable
      ? `Docker ${status.dockerVersion ?? ""}`
      : "Docker indisponível";
  }
  return (
    <Link
      to="/settings"
      search={{ tab: "server" }}
      className="flex items-center gap-2.5 rounded-lg border bg-surface px-3 py-2.5 transition-colors hover:bg-surface-raised focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <StatusDot online={online && status?.dockerAvailable === true} />
      <span className="min-w-0">
        <span className="block text-sm font-medium">
          {online ? "Worker online" : "Worker offline"}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
    </Link>
  );
}

function ContextNavigation({ user, onNavigate }: { readonly user: SessionUser } & NavigateProps) {
  const projectId = useCurrentProjectId();
  const pathname = usePathname();
  if (projectId != null) {
    return <ProjectNavigation projectId={projectId} onNavigate={onNavigate} />;
  }
  if (pathname.startsWith("/settings")) {
    return <SettingsNavigation permissions={user.permissions} onNavigate={onNavigate} />;
  }
  return (
    <OverviewNavigation
      canCreate={user.permissions.includes("project:write")}
      onNavigate={onNavigate}
    />
  );
}

function ContextSidebar({ user }: { readonly user: SessionUser }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar px-3 py-4 lg:flex">
      <nav aria-label="Navegação da seção" className="space-y-5 overflow-y-auto">
        <ContextNavigation user={user} />
      </nav>
      <WorkerStatus />
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Top bar                                                                    */
/* -------------------------------------------------------------------------- */

function useBreadcrumb(): string {
  const pathname = usePathname();
  const search = useSearch({ strict: false });
  const projectId = useCurrentProjectId();
  if (projectId != null) {
    const suffix = pathname.slice(`/projects/${projectId}`.length);
    const section = PROJECT_SECTIONS.find(
      (item) =>
        item.to.slice("/projects/$projectId".length) !== "" &&
        suffix.startsWith(item.to.slice("/projects/$projectId".length)),
    );
    return section?.label ?? "Visão geral";
  }
  if (pathname.startsWith("/settings")) {
    const tab = typeof search.tab === "string" ? search.tab : "organization";
    return SETTINGS_SECTIONS.find((section) => section.tab === tab)?.label ?? "Configurações";
  }
  if (pathname === "/projects/new") {
    return "Novo projeto";
  }
  const rail = RAIL_ITEMS.find((item) =>
    item.exact ? pathname === item.to : pathname.startsWith(item.to),
  );
  return rail?.label ?? "Painel";
}

function projectCountLabel(count: number): string {
  return count === 1 ? "1 projeto" : `${count} projetos`;
}

function ContextSwitcher() {
  const projectId = useCurrentProjectId();
  const projects = useQuery(projectsQuery());
  const current = projects.data?.find((project) => project.id === projectId) ?? null;
  const online = current?.containerState === "running";
  const title = current?.name ?? "Nelcota Deploy";
  const subtitle =
    current == null
      ? projectCountLabel(projects.data?.length ?? 0)
      : `${online ? "Online" : "Offline"} · ${current.repositoryFullName}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none"
        >
          <FolderIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block truncate text-sm leading-tight font-semibold">{title}</span>
            <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              {current == null ? null : (
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    online ? "bg-success" : "bg-muted-foreground/60",
                  )}
                />
              )}
              <span className="truncate">{subtitle}</span>
            </span>
          </span>
          <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Projetos</DropdownMenuLabel>
        {(projects.data ?? []).map((project) => (
          <DropdownMenuItem key={project.id} asChild>
            <Link to="/projects/$projectId" params={{ projectId: project.id }}>
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  project.containerState === "running" ? "bg-success" : "bg-muted-foreground/60",
                )}
              />
              <span className="truncate">{project.name}</span>
            </Link>
          </DropdownMenuItem>
        ))}
        {projects.data?.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum projeto ainda.</p>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/projects">
            <BoxesIcon aria-hidden />
            Todos os projetos
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/projects/new">
            <PlusIcon aria-hidden />
            Novo projeto
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user }: { readonly user: SessionUser }) {
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
          className="flex items-center gap-3 rounded-lg py-1.5 pr-2 pl-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none"
        >
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
          >
            {initialsOf(user.name)}
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block max-w-40 truncate text-sm leading-tight font-semibold">
              {user.name}
            </span>
            <span className="block text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</span>
          </span>
          <ChevronDownIcon aria-hidden className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate font-semibold">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOutIcon aria-hidden />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
      <SheetContent side="left" className="w-80 overflow-y-auto px-3 py-6">
        <SheetTitle className="px-1">
          <NelcotaLogo aria-label="Nelcota Deploy" className="h-6 w-auto text-foreground" />
        </SheetTitle>
        <nav aria-label="Áreas" className="grid grid-cols-4 gap-1 border-b pb-4">
          {RAIL_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact }}
              onClick={() => setOpen(false)}
              className="flex flex-col items-center gap-1 rounded-lg py-2 text-xs text-muted-foreground hover:bg-sidebar-accent data-[status=active]:bg-sidebar-accent data-[status=active]:text-foreground"
            >
              <item.icon aria-hidden className="size-5" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="space-y-5">
          <ContextNavigation user={user} onNavigate={() => setOpen(false)} />
        </div>
        <WorkerStatus />
      </SheetContent>
    </Sheet>
  );
}

function TopBar({ user, onSearch }: { readonly user: SessionUser; readonly onSearch: () => void }) {
  const breadcrumb = useBreadcrumb();
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-sidebar-border bg-sidebar/60 px-3 backdrop-blur md:px-5">
      <div className="flex min-w-0 items-center gap-1">
        <MobileMenu user={user} />
        <ContextSwitcher />
        <ChevronRightIcon
          aria-hidden
          className="mx-1 hidden size-4 shrink-0 text-muted-foreground/60 sm:block"
        />
        <span className="hidden truncate text-sm font-medium sm:block">{breadcrumb}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSearch}
          className="hidden h-10 w-64 items-center gap-2.5 rounded-lg border border-border bg-surface-sunken/70 px-3 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none md:flex"
        >
          <SearchIcon aria-hidden className="size-4" />
          Buscar…
          <kbd className="ml-auto rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-xs">
            Ctrl K
          </kbd>
        </button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Buscar"
          className="md:hidden"
          onClick={onSearch}
        >
          <SearchIcon aria-hidden />
        </Button>
        <UserMenu user={user} />
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Application frame: icon rail, contextual sidebar (project pages, settings sections or
 * general links), top bar with the project switcher, search and user menu.
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
  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <IconRail />
      <ContextSidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} onSearch={() => setSearchOpen(true)} />
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
