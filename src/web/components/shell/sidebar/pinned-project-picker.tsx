import { Link } from "@tanstack/react-router";
import { PinIcon, PlusIcon } from "lucide-react";

import { ProjectChoices } from "@/web/components/shell/sidebar/project-choices";
import { SidebarHint } from "@/web/components/shell/sidebar/sidebar-link";
import { PINNED_PROJECT_LIMIT } from "@/web/components/shell/sidebar/sidebar-preferences";
import type { SidebarProject } from "@/web/components/shell/sidebar/sidebar-project-link";
import type { SidebarState } from "@/web/components/shell/sidebar/use-sidebar-preferences";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/web/components/ui/dialog";

/** Project shortcuts are personal navigation preferences, available even to read-only users. */
export function PinnedProjectPicker({
  projects,
  sidebar,
  collapsed,
  onNavigate,
}: {
  readonly projects: readonly SidebarProject[];
  readonly sidebar: SidebarState;
  readonly collapsed: boolean;
  readonly onNavigate: () => void;
}) {
  const can = useCan();
  return (
    <div className={collapsed ? "flex w-full flex-col items-center gap-1" : "flex items-center"}>
      <Dialog>
        <SidebarHint label="Gerenciar projetos fixados">
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Gerenciar projetos fixados"
              disabled={projects.length === 0}
            >
              <PinIcon aria-hidden />
            </Button>
          </DialogTrigger>
        </SidebarHint>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Projetos fixados</DialogTitle>
            <DialogDescription>
              Escolha até {PINNED_PROJECT_LIMIT} projetos para acessar pelo menu lateral. Sua
              escolha fica salva neste navegador.
            </DialogDescription>
          </DialogHeader>
          <ProjectChoices projects={projects} sidebar={sidebar} />
        </DialogContent>
      </Dialog>
      {can("project:write") ? (
        <SidebarHint label="Novo projeto">
          <Button asChild variant="ghost" size="icon-xs">
            <Link to="/projects/new" aria-label="Novo projeto" onClick={onNavigate}>
              <PlusIcon aria-hidden />
            </Link>
          </Button>
        </SidebarHint>
      ) : null}
    </div>
  );
}
