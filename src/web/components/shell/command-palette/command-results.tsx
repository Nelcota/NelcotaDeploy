import { SearchXIcon } from "lucide-react";

import type { Command } from "@/web/components/shell/command-palette/command-search";
import { cn } from "@/web/components/ui/class-names";

const GROUP_ORDER = ["Projetos", "Páginas", "Administração"] as const;

function CommandOption({
  command,
  active,
  onHover,
  onChoose,
}: {
  readonly command: Command;
  readonly active: boolean;
  readonly onHover: () => void;
  readonly onChoose: () => void;
}) {
  return (
    <button
      type="button"
      id={command.id}
      role="option"
      tabIndex={-1}
      aria-selected={active}
      onMouseMove={onHover}
      onClick={onChoose}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors motion-reduce:transition-none",
        active ? "bg-secondary text-foreground" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md ring-1 ring-border/70",
          active ? "bg-background text-foreground" : "bg-muted/40 text-faint",
        )}
      >
        <command.icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{command.label}</span>
      {command.hint == null ? null : (
        <span className="hidden max-w-[45%] truncate font-mono text-xs text-faint sm:block">
          {command.hint}
        </span>
      )}
    </button>
  );
}

function EmptyResults() {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-12 text-center">
      <SearchXIcon aria-hidden className="size-5 text-faint" />
      <p className="text-sm text-muted-foreground">Nada encontrado.</p>
    </div>
  );
}

/** Results of the palette, grouped under "Projetos", "Páginas" and "Administração". */
export function CommandResults({
  id,
  commands,
  activeIndex,
  onActiveIndexChange,
  onChoose,
}: {
  readonly id: string;
  readonly commands: readonly Command[];
  readonly activeIndex: number;
  readonly onActiveIndexChange: (index: number) => void;
  readonly onChoose: (command: Command) => void;
}) {
  const groups = Object.groupBy(commands, (command) => command.group);
  const activeId = commands[activeIndex]?.id;
  return (
    <div id={id} role="listbox" className="max-h-[min(28rem,60vh)] overflow-y-auto p-2">
      {commands.length === 0 ? <EmptyResults /> : null}
      {GROUP_ORDER.map((group) => {
        const items = groups[group] ?? [];
        if (items.length === 0) {
          return null;
        }
        return (
          <div key={group} role="group" aria-label={group} className="pb-1">
            <p aria-hidden className="px-2.5 pt-2.5 pb-1.5 text-xs font-medium text-faint">
              {group}
            </p>
            {items.map((command) => (
              <CommandOption
                key={command.id}
                command={command}
                active={activeId === command.id}
                onHover={() => onActiveIndexChange(commands.indexOf(command))}
                onChoose={() => onChoose(command)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
