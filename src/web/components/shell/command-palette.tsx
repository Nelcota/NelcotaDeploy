import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BoxesIcon, CornerDownLeftIcon, type LucideIcon, PlusIcon, SearchIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";

import { MAIN_AREAS, SETTINGS_SECTIONS } from "@/web/components/shell/navigation";
import { cn } from "@/web/components/ui/class-names";
import { Dialog, DialogContent, DialogTitle } from "@/web/components/ui/dialog";
import { listProjectsFn } from "@/web/functions/projects.functions";

type Command = {
  readonly id: string;
  readonly group: "Projetos" | "Páginas";
  readonly label: string;
  readonly hint: string;
  readonly icon: LucideIcon;
  readonly run: () => Promise<void>;
};

/** Opens the palette with Ctrl+K or Cmd+K anywhere in the panel. */
export function useCommandPaletteShortcut(open: () => void): void {
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Keyboard-first search over projects and panel pages. */
export function CommandPalette({
  open,
  onOpenChange,
  permissions,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly permissions: readonly string[];
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const projects = useQuery({
    queryKey: ["projects", ""],
    queryFn: () => listProjectsFn({ data: { search: "" } }),
    enabled: open,
  });

  const commands = useMemo<Command[]>(() => {
    const projectCommands: Command[] = (projects.data ?? []).map((project) => ({
      id: `project-${project.id}`,
      group: "Projetos",
      label: project.name,
      hint: project.repositoryFullName,
      icon: BoxesIcon,
      run: async () =>
        await navigate({ to: "/projects/$projectId", params: { projectId: project.id } }),
    }));
    const pageCommands: Command[] = [
      ...MAIN_AREAS.map((item) => ({
        id: `page-${item.to}`,
        group: "Páginas" as const,
        label: item.label,
        hint: "Página",
        icon: item.icon,
        run: async () => await navigate({ to: item.to }),
      })),
      ...(permissions.includes("project:write")
        ? [
            {
              id: "page-new-project",
              group: "Páginas" as const,
              label: "Novo projeto",
              hint: "Criar projeto",
              icon: PlusIcon,
              run: async () => await navigate({ to: "/projects/new" }),
            },
          ]
        : []),
      ...SETTINGS_SECTIONS.filter(
        (section) => section.permission == null || permissions.includes(section.permission),
      ).map((section) => ({
        id: `settings-${section.tab}`,
        group: "Páginas" as const,
        label: `Administração · ${section.label}`,
        hint: "Administração",
        icon: section.icon,
        run: async () => await navigate({ to: "/settings", search: { tab: section.tab } }),
      })),
    ];
    const needle = normalize(query.trim());
    return [...projectCommands, ...pageCommands].filter(
      (command) => needle === "" || normalize(`${command.label} ${command.hint}`).includes(needle),
    );
  }, [projects.data, navigate, permissions, query]);

  // A new search or a reopened palette selects the first result again; adjusting during
  // render avoids an extra effect pass.
  const selectionKey = `${String(open)}:${query}`;
  const [selectionResetKey, setSelectionResetKey] = useState(selectionKey);
  if (selectionKey !== selectionResetKey) {
    setSelectionResetKey(selectionKey);
    setActiveIndex(0);
  }

  // Arrow keys move the selection; keep it inside the scrolling list.
  const activeId = commands[activeIndex]?.id;
  useEffect(() => {
    if (activeId == null) {
      return;
    }
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const choose = (command: Command | undefined) => {
    if (command == null) {
      return;
    }
    onOpenChange(false);
    setQuery("");
    void command.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, commands.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(commands[activeIndex]);
    }
  };

  const groups = Object.groupBy(commands, (command) => command.group);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next === false) {
          setQuery("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden border-0 bg-popover p-0 shadow-lg ring-1 ring-border sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Buscar no painel</DialogTitle>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <SearchIcon aria-hidden className="size-4 text-faint" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={commands[activeIndex]?.id}
            aria-label="Buscar projetos e páginas"
            placeholder="Buscar projetos e páginas…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 font-mono text-xs text-faint">
            Esc
          </kbd>
        </div>
        <div id="command-results" role="listbox" className="max-h-[22rem] overflow-y-auto p-2">
          {commands.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nada encontrado.</p>
          ) : null}
          {(["Projetos", "Páginas"] as const).map((group) => {
            const items = groups[group] ?? [];
            if (items.length === 0) {
              return null;
            }
            return (
              <div key={group} className="pb-2">
                <p className="px-3 pt-2 pb-1 text-xs font-medium text-faint">{group}</p>
                {items.map((command) => {
                  const active = commands[activeIndex]?.id === command.id;
                  return (
                    <button
                      type="button"
                      key={command.id}
                      id={command.id}
                      role="option"
                      tabIndex={-1}
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(commands.indexOf(command))}
                      onClick={() => choose(command)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-secondary hover:text-foreground",
                        active ? "bg-secondary text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <command.icon aria-hidden className="size-4 shrink-0 text-faint" />
                      <span className="truncate text-sm font-medium">{command.label}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {command.hint}
                      </span>
                      {active ? (
                        <CornerDownLeftIcon
                          aria-hidden
                          className="size-3.5 shrink-0 text-muted-foreground"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
