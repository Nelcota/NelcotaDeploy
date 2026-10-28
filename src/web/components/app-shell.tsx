import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import {
  ActivityIcon,
  ChevronDownIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  RefreshCwIcon,
  SearchIcon,
  SunIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { getDashboardFn, getSidebarStatusFn } from "@/web/functions/dashboard.functions";
import { listProjectsFn } from "@/web/functions/projects.functions";
import type { SessionUser } from "@/web/functions/session.functions";

import { authClient } from "./auth-client";
import { NelcotaMark } from "./brand-logo";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { useDeploymentNotifications } from "./deployment-notifications";
import { ROLE_LABELS } from "./labels";
import { MAIN_AREAS } from "./navigation";
import { containerAccent, type RowAccent } from "./project-accent";
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

const STATUS_POLL_INTERVAL_IN_MS = 10_000;
/** Projects listed in the sidebar; the rest are one click away on the projects page. */
const SIDEBAR_PROJECT_LIMIT = 6;

const ACCENT_DOTS: Record<RowAccent, string> = {
  none: "bg-faint",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  progress: "bg-brand",
  neutral: "bg-faint",
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Worker and Docker health plus running deployments, shared by the sidebar and the top bar. */
function useSystemStatus() {
  return useQuery({
    queryKey: ["sidebar-status"],
    queryFn: () => getSidebarStatusFn(),
    refetchInterval: STATUS_POLL_INTERVAL_IN_MS,
  });
}

function useProjectList() {
  return useQuery({
    queryKey: ["projects", ""],
    queryFn: () => listProjectsFn({ data: { search: "" } }),
    refetchInterval: STATUS_POLL_INTERVAL_IN_MS,
  });
}

function Brand() {
  return (
    <Link
      to="/"
      aria-label="Nelcota Deploy — Painel"
      className="flex shrink-0 items-center gap-3 rounded-lg px-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <NelcotaMark aria-hidden className="h-8 w-auto" />
      <span className="text-xl font-semibold tracking-tight">Nelcota Deploy</span>
    </Link>
  );
}

function CountBadge({ count }: { readonly count: number }) {
  return (
    <span className="ml-auto min-w-6 rounded-md bg-well px-1.5 py-0.5 text-center text-xs font-medium text-muted-foreground tabular-nums group-data-[status=active]:bg-white/20 group-data-[status=active]:text-primary-foreground">
      {count}
    </span>
  );
}

const SIDEBAR_ITEM =
  "group flex h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-primary data-[status=active]:text-primary-foreground";

function SidebarGroup({
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

function SidebarProjects({ onNavigate }: { readonly onNavigate: () => void }) {
  const projects = useProjectList();
  const list = projects.data ?? [];
  if (projects.isPending) {
    return null;
  }
  return (
    <SidebarGroup label="Projetos">
      {list.length === 0 ? <p className="px-3 text-sm text-faint">Nenhum projeto ainda.</p> : null}
      {list.slice(0, SIDEBAR_PROJECT_LIMIT).map((project) => (
        <Link
          key={project.id}
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          onClick={onNavigate}
          className="flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-well data-[status=active]:text-foreground"
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              ACCENT_DOTS[containerAccent(project.containerState, project.containerHealth)],
            )}
          />
          <span className="truncate">{project.name}</span>
        </Link>
      ))}
      {list.length > SIDEBAR_PROJECT_LIMIT ? (
        <Link
          to="/projects"
          onClick={onNavigate}
          className="flex h-9 items-center px-3 text-sm text-faint transition-colors hover:text-foreground"
        >
          Ver todos ({list.length})
        </Link>
      ) : null}
    </SidebarGroup>
  );
}

/** Sidebar body: brand, the overview areas with counts, the projects, and the account area. */
function SidebarContent({ onNavigate }: { readonly onNavigate: () => void }) {
  const projects = useProjectList();
  const status = useSystemStatus();
  const counts: Readonly<Record<string, number | null>> = {
    "/projects": projects.data?.length ?? null,
    "/deployments": status.data?.activeDeployments ?? null,
  };
  return (
    <div className="flex h-full w-full flex-col px-4 pb-5">
      <div className="flex h-20 shrink-0 items-center">
        <Brand />
      </div>
      <nav
        aria-label="Principal"
        className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto pt-4"
      >
        <SidebarGroup label="Visão geral">
          {MAIN_AREAS.filter((area) => area.group === "overview").map((area) => {
            const count = counts[area.to] ?? null;
            return (
              <Link
                key={area.to}
                to={area.to}
                activeOptions={{ exact: area.exact }}
                onClick={onNavigate}
                className={SIDEBAR_ITEM}
              >
                <area.icon aria-hidden className="size-[1.15rem] shrink-0" />
                {area.label}
                {count == null || count === 0 ? null : <CountBadge count={count} />}
              </Link>
            );
          })}
        </SidebarGroup>
        <SidebarProjects onNavigate={onNavigate} />
      </nav>
      <div className="border-t border-border pt-5">
        <SidebarGroup label="Conta">
          {MAIN_AREAS.filter((area) => area.group === "account").map((area) => (
            <Link
              key={area.to}
              to={area.to}
              activeOptions={{ exact: area.exact }}
              onClick={onNavigate}
              className={SIDEBAR_ITEM}
            >
              <area.icon aria-hidden className="size-[1.15rem] shrink-0" />
              {area.label}
            </Link>
          ))}
        </SidebarGroup>
      </div>
    </div>
  );
}

function MobileNavigation() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Abrir menu" className="lg:hidden">
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-background p-0">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <SidebarContent onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

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
function ShortcutPills() {
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboardFn(),
    refetchInterval: STATUS_POLL_INTERVAL_IN_MS,
  });
  const status = useSystemStatus();
  return (
    <nav aria-label="Atalhos" className="hidden items-center gap-2 xl:flex">
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

function SearchButton({ onSearch }: { readonly onSearch: () => void }) {
  return (
    <button
      type="button"
      onClick={onSearch}
      aria-label="Buscar projetos e páginas"
      className="flex size-10 shrink-0 items-center justify-center gap-3 rounded-full bg-well text-sm text-muted-foreground ring-1 ring-border transition-colors hover:bg-well-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-auto sm:min-w-0 sm:max-w-md sm:flex-1 sm:shrink sm:justify-start sm:px-4"
    >
      <SearchIcon aria-hidden className="size-4 shrink-0" />
      <span className="hidden truncate sm:inline">Buscar projetos, deploys e páginas</span>
      <kbd className="ml-auto hidden rounded border border-border px-1.5 font-mono text-xs whitespace-nowrap text-faint sm:inline">
        Ctrl K
      </kbd>
    </button>
  );
}

const ROUND_ICON_BUTTON =
  "relative flex size-10 shrink-0 items-center justify-center rounded-full bg-well text-muted-foreground ring-1 ring-border transition-colors hover:bg-well-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function RefreshButton() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
    } catch (error) {
      console.error("failed to refresh queries", error);
      toast.error("Não foi possível atualizar. Tente novamente.");
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Atualizar dados"
          onClick={() => void refresh()}
          className={ROUND_ICON_BUTTON}
        >
          <RefreshCwIcon aria-hidden className={cn("size-4", refreshing ? "animate-spin" : "")} />
        </button>
      </TooltipTrigger>
      <TooltipContent>Atualizar dados</TooltipContent>
    </Tooltip>
  );
}

/** Worker and Docker health in one icon; the badge color and the tooltip tell the state. */
function SystemStatus() {
  const status = useSystemStatus();
  const worker = status.data?.worker ?? null;
  const active = status.data?.activeDeployments ?? 0;
  const healthy = worker?.online === true && worker.dockerAvailable;
  let label = "Sistema operando";
  if (worker == null || worker.online === false) {
    label = "Worker parado";
  } else if (worker.dockerAvailable === false) {
    label = "Docker indisponível";
  } else if (active > 0) {
    label = active === 1 ? "1 deploy em andamento" : `${active} deploys em andamento`;
  }
  let dot = "bg-destructive";
  if (healthy) {
    dot = active > 0 ? "bg-brand animate-pulse" : "bg-success";
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/settings"
          search={{ tab: "server" }}
          aria-label={label}
          className={ROUND_ICON_BUTTON}
        >
          <ActivityIcon aria-hidden className="size-4" />
          <span
            aria-hidden
            className={cn(
              "absolute -top-0.5 -right-0.5 size-3 rounded-full ring-2 ring-background",
              dot,
            )}
          />
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {worker?.dockerVersion == null ? "" : ` · Docker ${worker.dockerVersion}`}
      </TooltipContent>
    </Tooltip>
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
          aria-label={`Conta de ${user.name}`}
          className="flex shrink-0 items-center gap-3 rounded-full py-1 pr-2 pl-1 transition-colors hover:bg-well focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {initialsOf(user.name)}
          </span>
          <span className="hidden min-w-0 text-left md:block">
            <span className="block max-w-36 truncate text-sm font-medium">{user.name}</span>
            <span className="block text-xs text-faint">{ROLE_LABELS[user.role]}</span>
          </span>
          <ChevronDownIcon aria-hidden className="hidden size-4 text-muted-foreground md:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate font-semibold">{user.name}</p>
          <p className="truncate text-sm text-muted-foreground">
            {user.email} · {ROLE_LABELS[user.role]}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={toggleTheme}>
          {theme === "dark" ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
          {theme === "dark" ? "Tema claro" : "Tema escuro"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOutIcon aria-hidden />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Application frame: a sidebar with the areas and projects, a top bar with shortcuts,
 * search, refresh, system status and account, and the page on a raised panel. Only the
 * panel scrolls, so the bars stay put and page content never slides under them.
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
  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Pular para o conteúdo
      </a>
      <aside className="hidden h-full w-[17rem] shrink-0 lg:flex">
        <SidebarContent onNavigate={() => undefined} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-20 shrink-0 items-center gap-3 bg-background px-4 lg:px-6">
          <MobileNavigation />
          <ShortcutPills />
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2.5">
            <SearchButton onSearch={() => setSearchOpen(true)} />
            <RefreshButton />
            <SystemStatus />
            <AccountMenu user={user} />
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          data-scroll-restoration-id="main"
          className="min-h-0 flex-1 overflow-y-auto bg-panel ring-1 ring-border/60 focus:outline-none lg:rounded-tl-3xl"
        >
          {children}
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

/** Standard page body: full-width column with vertical rhythm. */
export function PageBody({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[110rem] space-y-6 p-4 md:p-6", className)}>
      {children}
    </div>
  );
}
