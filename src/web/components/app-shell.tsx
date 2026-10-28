import { useQuery } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { LogOutIcon, MenuIcon, MoonIcon, SearchIcon, SunIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { getSidebarStatusFn } from "@/web/functions/dashboard.functions";
import type { SessionUser } from "@/web/functions/session.functions";

import { authClient } from "./auth-client";
import { NelcotaMark } from "./brand-logo";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { useDeploymentNotifications } from "./deployment-notifications";
import { ROLE_LABELS } from "./labels";
import { MAIN_AREAS } from "./navigation";
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

/** Width of every page; wide enough for tables, narrow enough to read. */
const PAGE_WIDTH = "mx-auto w-full max-w-[76rem] px-5 md:px-8";

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

function PrimaryNavigation() {
  return (
    <nav aria-label="Principal" className="hidden h-full items-stretch gap-7 md:flex">
      {MAIN_AREAS.map((area) => (
        <Link
          key={area.to}
          to={area.to}
          activeOptions={{ exact: area.exact }}
          className="relative flex items-center text-sm font-medium text-muted-foreground transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent hover:text-foreground focus-visible:text-foreground focus-visible:outline-none data-[status=active]:text-foreground data-[status=active]:after:bg-primary"
        >
          {area.label}
        </Link>
      ))}
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
          className="hidden items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:flex"
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
      className="flex h-9 items-center gap-2.5 rounded-lg bg-secondary px-3 text-sm text-muted-foreground ring-1 ring-border ring-inset transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-56"
    >
      <SearchIcon aria-hidden className="size-4" />
      <span className="hidden sm:inline">Buscar</span>
      <kbd className="ml-auto hidden rounded border border-border px-1.5 font-mono text-xs text-faint sm:inline">
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
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground ring-offset-2 ring-offset-background transition-shadow hover:ring-2 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
 * Application frame: a top bar with the main areas, system status, search and account,
 * then the page at full width. Project pages add their own header and tabs.
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
    <div className="flex min-h-svh flex-col bg-background">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-40 border-b border-sidebar-border bg-background/85 backdrop-blur-md">
        <div className={cn(PAGE_WIDTH, "flex h-16 items-center gap-6")}>
          <MobileNavigation />
          <Brand />
          <PrimaryNavigation />
          <div className="ml-auto flex items-center gap-2">
            <SystemStatus />
            <SearchButton onSearch={() => setSearchOpen(true)} />
            <AccountMenu user={user} />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
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
  return <div className={cn(PAGE_WIDTH, "space-y-10 py-10", className)}>{children}</div>;
}
