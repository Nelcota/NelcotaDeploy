import { CornerDownLeftIcon } from "lucide-react";

import type { Command } from "@/web/components/shell/command-palette/command-search";
import { cn } from "@/web/components/ui/class-names";

const GROUP_ORDER = ["Projetos", "Páginas"] as const;

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
      onMouseEnter={onHover}
      onClick={onChoose}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-secondary hover:text-foreground",
        active ? "bg-secondary text-foreground" : "text-muted-foreground",
      )}
    >
      <command.icon aria-hidden className="size-4 shrink-0 text-faint" />
      <span className="truncate text-sm font-medium">{command.label}</span>
      <span className="ml-auto truncate text-xs text-muted-foreground">{command.hint}</span>
      {active ? (
        <CornerDownLeftIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
    </button>
  );
}

/** Results of the palette, grouped under "Projetos" and "Páginas". */
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
    <div id={id} role="listbox" className="max-h-[22rem] overflow-y-auto p-2">
      {commands.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nada encontrado.</p>
      ) : null}
      {GROUP_ORDER.map((group) => {
        const items = groups[group] ?? [];
        if (items.length === 0) {
          return null;
        }
        return (
          <div key={group} className="pb-2">
            <p className="px-3 pt-2 pb-1 text-xs font-medium text-faint">{group}</p>
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
