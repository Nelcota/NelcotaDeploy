import { Link, useRouter } from "@tanstack/react-router";
import {
  BoxesIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  RocketIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { SessionUser } from "@/web/functions/session.functions";

import { authClient } from "./auth-client";
import { NelcotaLogo } from "./brand-logo";
import { ROLE_LABELS } from "./labels";
import { useTheme } from "./theme";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./ui/sheet";

const NAVIGATION = [
  { to: "/", label: "Painel", icon: LayoutDashboardIcon, exact: true },
  { to: "/projects", label: "Projetos", icon: BoxesIcon, exact: false },
  { to: "/deployments", label: "Deploys", icon: RocketIcon, exact: false },
  { to: "/settings", label: "Configurações", icon: SettingsIcon, exact: false },
] as const;

function NavigationLinks({ onNavigate }: { readonly onNavigate?: () => void }) {
  return (
    <nav aria-label="Principal" className="flex flex-col gap-1">
      <p className="px-3.5 pb-2 text-[0.72rem] font-semibold tracking-[0.12em] text-muted-foreground/80 uppercase">
        Plataforma
      </p>
      {NAVIGATION.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: item.exact }}
          onClick={onNavigate}
          className="group relative flex h-11 items-center gap-3 rounded-xl px-3.5 text-[0.95rem] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none data-[status=active]:bg-accent data-[status=active]:font-semibold data-[status=active]:text-accent-foreground"
        >
          <item.icon
            aria-hidden
            className="size-[1.15rem] transition-colors group-data-[status=active]:text-brand"
          />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function UserFooter({ user }: { readonly user: SessionUser }) {
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
  const initials = user.name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="space-y-3 rounded-2xl border border-sidebar-border bg-surface/70 p-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-[0.92rem] font-bold text-primary-foreground"
        >
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[0.92rem] font-semibold">{user.name}</p>
          <p className="truncate text-[0.8rem] text-muted-foreground">{ROLE_LABELS[user.role]}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={toggleTheme}>
          {theme === "dark" ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
          {theme === "dark" ? "Tema claro" : "Tema escuro"}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => void signOut()}
          aria-label="Sair"
          title="Sair"
        >
          <LogOutIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link
      to="/"
      aria-label="Nelcota Deploy — Painel"
      className="flex items-center gap-3 rounded-xl px-2 py-1 focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none"
    >
      <NelcotaLogo className="h-7 w-auto text-foreground" />
      <span className="rounded-md bg-accent px-2 py-0.5 text-[0.7rem] font-bold tracking-[0.14em] text-accent-foreground uppercase">
        Deploy
      </span>
    </Link>
  );
}

/** Desktop sidebar plus a slide-over menu on small screens. */
export function AppSidebar({ user }: { readonly user: SessionUser }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="sticky top-0 hidden h-svh w-72 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar px-4 py-6 md:flex">
        <div className="space-y-9">
          <Brand />
          <NavigationLinks />
        </div>
        <UserFooter user={user} />
      </aside>
      <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-sidebar/95 px-4 py-3 backdrop-blur md:hidden">
        <Brand />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Abrir menu">
              <MenuIcon aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="flex w-80 flex-col justify-between bg-sidebar px-4 py-6"
          >
            <div className="space-y-9">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <Brand />
              <NavigationLinks onNavigate={() => setOpen(false)} />
            </div>
            <UserFooter user={user} />
          </SheetContent>
        </Sheet>
      </header>
    </>
  );
}
