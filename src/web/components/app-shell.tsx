import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { getSidebarStatusFn } from "@/web/functions/dashboard.functions";
import type { SessionUser } from "@/web/functions/session.functions";

import { authClient } from "./auth-client";
import { NelcotaMark } from "./brand-logo";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { useDeploymentNotifications } from "./deployment-notifications";
import { ROLE_LABELS } from "./labels";
import { breadcrumbTrail, MAIN_AREAS, projectIdFromPath } from "./navigation";
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

const STATUS_POLL_INTERVAL_IN_MS = 10_000;

/** Width of every page; the panel uses the screen, but very wide monitors keep a margin. */
const PAGE_WIDTH = "mx-auto w-full max-w-[96rem] px-5 md:px-8";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Brand() {
  return (
    <Link
      to="/"
      aria-label="Nelcota Deploy — Painel"
      className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <NelcotaMark className="h-7 w-auto" />
      <span className="text-base font-bold tracking-tight">
        Nelcota <span className="font-medium text-muted-foreground">Deploy</span>
      </span>
    </Link>
  );
}

/** The official blue Nelcota symbol on a white tile, at the top of the icon rail. */
function BrandTile() {
  return (
    <Link
      to="/"
      aria-label="Nelcota Deploy — Painel"
      className="flex size-10 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <img src="/nelcota-symbol-blue.svg" alt="" width={28} height={28} className="size-7" />
    </Link>
  );
}

/** Narrow column of icons for the main areas; the tooltip and the label name each one. */
function RailNavigation() {
  return (
    <nav aria-label="Principal" className="flex flex-col items-center gap-2">
      {MAIN_AREAS.map((area) => (
        <Tooltip key={area.to}>
          <TooltipTrigger asChild>
            <Link
              to={area.to}
              activeOptions={{ exact: area.exact }}
              aria-label={area.label}
              className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-well data-[status=active]:text-foreground data-[status=active]:ring-1 data-[status=active]:ring-border/70"
            >
              <area.icon aria-hidden className="size-[1.15rem]" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{area.label}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}

function HistoryButtons() {
  const router = useRouter();
  return (
    <div className="hidden items-center sm:flex">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Voltar"
        onClick={() => router.history.back()}
      >
        <ArrowLeftIcon aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Avançar"
        onClick={() => router.history.forward()}
      >
        <ArrowRightIcon aria-hidden />
      </Button>
    </div>
  );
}

/** Where the current page sits, from the dashboard down; the project name comes from its cache. */
function Breadcrumbs() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const projectId = projectIdFromPath(pathname);
  const project = useQuery({ ...projectQueryOptions(projectId ?? ""), enabled: projectId != null });
  const projectName = projectId == null ? null : (project.data?.project.name ?? null);
  const trail = breadcrumbTrail(pathname, projectName);
  return (
    <nav aria-label="Trilha de navegação" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {trail.map((crumb, index) => (
          <li
            key={`${index}-${crumb.label}`}
            className={cn(
              "min-w-0 items-center gap-1.5",
              index === trail.length - 1 ? "flex" : "hidden sm:flex",
            )}
          >
            {index > 0 ? (
              <ChevronRightIcon
                aria-hidden
                className="hidden size-3.5 shrink-0 text-faint sm:block"
              />
            ) : null}
            {crumb.link == null ? (
              <span aria-current="page" className="truncate font-medium text-foreground">
                {crumb.label}
              </span>
            ) : (
              <Link
                {...crumb.link}
                className="truncate text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
              >
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Worker and Docker health in one dot; the tooltip and the server page tell the details. */
function SystemStatus() {
  const status = useQuery({
    queryKey: ["sidebar-status"],
    queryFn: () => getSidebarStatusFn(),
    refetchInterval: STATUS_POLL_INTERVAL_IN_MS,
  });
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
          className="hidden h-9 items-center gap-2 rounded-xl bg-well px-3 text-xs font-medium text-muted-foreground ring-1 ring-border/50 transition-colors hover:bg-well-hover hover:text-foreground lg:flex"
        >
          <span aria-hidden className={cn("size-2 rounded-full", dot)} />
          {label}
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        {worker?.dockerVersion == null
          ? "Estado do worker e do Docker"
          : `Docker ${worker.dockerVersion}`}
      </TooltipContent>
    </Tooltip>
  );
}

function SearchButton({ onSearch }: { readonly onSearch: () => void }) {
  return (
    <button
      type="button"
      onClick={onSearch}
      aria-label="Buscar projetos e páginas"
      className="flex h-9 items-center gap-2.5 rounded-xl bg-well px-3 text-sm text-muted-foreground ring-1 ring-border/50 transition-colors hover:bg-well-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-64"
    >
      <SearchIcon aria-hidden className="size-4" />
      <span className="hidden truncate sm:inline">Buscar…</span>
      <kbd className="ml-auto hidden rounded border border-border px-1.5 font-mono text-xs whitespace-nowrap text-faint sm:inline">
        Ctrl K
      </kbd>
    </button>
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
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-xs font-bold text-primary-foreground ring-offset-2 ring-offset-background transition-shadow hover:ring-2 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {initialsOf(user.name)}
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

function MobileNavigation() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Abrir menu" className="md:hidden">
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-6 bg-background px-5 py-6">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <Brand />
        <nav aria-label="Principal" className="flex flex-col gap-1">
          {MAIN_AREAS.map((area) => (
            <Link
              key={area.to}
              to={area.to}
              activeOptions={{ exact: area.exact }}
              onClick={() => setOpen(false)}
              className="flex h-11 items-center gap-3 rounded-lg px-3 text-base text-muted-foreground data-[status=active]:bg-secondary data-[status=active]:text-foreground"
            >
              <area.icon aria-hidden className="size-5" />
              {area.label}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Application frame: an icon rail with the main areas on the left, and a top bar with
 * history, breadcrumbs, system status, search and account above the page.
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
    <div className="flex min-h-svh">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Pular para o conteúdo
      </a>
      <aside className="sticky top-0 hidden h-svh w-[4.5rem] shrink-0 flex-col items-center gap-8 border-r border-sidebar-border/70 py-4 md:flex">
        <BrandTile />
        <RailNavigation />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 bg-background/70 backdrop-blur-md">
          <div className={cn(PAGE_WIDTH, "flex h-16 items-center gap-3")}>
            <MobileNavigation />
            <HistoryButtons />
            <Breadcrumbs />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <SystemStatus />
              <SearchButton onSearch={() => setSearchOpen(true)} />
              <AccountMenu user={user} />
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
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

/** Standard page body: centered column with vertical rhythm. */
export function PageBody({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={cn(PAGE_WIDTH, "space-y-8 pt-4 pb-10", className)}>{children}</div>;
}
