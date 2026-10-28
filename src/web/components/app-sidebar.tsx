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
      {NAVIGATION.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: item.exact }}
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-foreground"
        >
          <item.icon aria-hidden className="size-4" />
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
  return (
    <div className="space-y-3 border-t border-sidebar-border pt-4">
      <div className="min-w-0 px-1">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {user.email} · {ROLE_LABELS[user.role]}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={toggleTheme}>
          {theme === "dark" ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
          {theme === "dark" ? "Tema claro" : "Tema escuro"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void signOut()} aria-label="Sair">
          <LogOutIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 px-1 font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <RocketIcon aria-hidden className="size-4" />
      </span>
      Nelcota Deploy
    </Link>
  );
}

/** Desktop sidebar plus a slide-over menu on small screens. */
export function AppSidebar({ user }: { readonly user: SessionUser }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <div className="space-y-6">
          <Brand />
          <NavigationLinks />
        </div>
        <UserFooter user={user} />
      </aside>
      <header className="flex items-center justify-between border-b px-4 py-3 md:hidden">
        <Brand />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Abrir menu">
              <MenuIcon aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 flex-col justify-between bg-sidebar p-4">
            <div className="space-y-6">
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
