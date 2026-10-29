import { SearchIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";

import { CommandResults } from "@/web/components/shell/command-palette/command-results";
import { type Command, moveSelection } from "@/web/components/shell/command-palette/command-search";
import { useCommands } from "@/web/components/shell/command-palette/use-commands";
import { Dialog, DialogContent, DialogTitle } from "@/web/components/ui/dialog";

const RESULTS_ID = "command-results";

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

/** Index of the highlighted result; it goes back to the first one on a new search or reopen. */
function useActiveIndex(open: boolean, query: string, commands: readonly Command[]) {
  const [activeIndex, setActiveIndex] = useState(0);
  // Adjusting during render avoids an extra effect pass.
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

  return [activeIndex, setActiveIndex] as const;
}

function SearchInput({
  query,
  activeId,
  onQueryChange,
  onKeyDown,
}: {
  readonly query: string;
  readonly activeId: string | undefined;
  readonly onQueryChange: (query: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4">
      <SearchIcon aria-hidden className="size-4 text-faint" />
      <input
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls={RESULTS_ID}
        aria-activedescendant={activeId}
        aria-label="Buscar projetos e páginas"
        placeholder="Buscar projetos e páginas…"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
      />
      <kbd className="rounded border border-border px-1.5 font-mono text-xs text-faint">Esc</kbd>
    </div>
  );
}

type CommandPaletteProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly permissions: readonly string[];
};

/** Enter runs the highlighted command; the arrow keys move the highlight. */
function paletteKeyHandler({
  commands,
  activeIndex,
  setActiveIndex,
  choose,
}: {
  readonly commands: readonly Command[];
  readonly activeIndex: number;
  readonly setActiveIndex: (update: (index: number) => number) => void;
  readonly choose: (command: Command | undefined) => void;
}) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      choose(commands[activeIndex]);
      return;
    }
    const { key } = event;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => moveSelection(key, index, commands.length));
    }
  };
}

/** Keyboard-first search over projects and panel pages. */
export function CommandPalette({ open, onOpenChange, permissions }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const commands = useCommands({ open, permissions, query });
  const [activeIndex, setActiveIndex] = useActiveIndex(open, query, commands);

  const changeOpen = (next: boolean) => {
    if (next === false) {
      setQuery("");
    }
    onOpenChange(next);
  };

  const choose = (command: Command | undefined) => {
    if (command == null) {
      return;
    }
    changeOpen(false);
    void command.run();
  };

  const onKeyDown = paletteKeyHandler({ commands, activeIndex, setActiveIndex, choose });

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        showCloseButton={false}
        // Near the top on every screen, so results grow downward and the phone keyboard never
        // covers the search field; it does not take the bottom-sheet frame of other dialogs.
        className="inset-x-4 top-[12%] bottom-auto w-auto gap-0 overflow-hidden rounded-2xl p-0 data-[state=closed]:slide-out-to-bottom-0 data-[state=closed]:zoom-out-95 data-[state=open]:slide-in-from-bottom-0 data-[state=open]:zoom-in-95 sm:right-auto sm:left-[50%] sm:top-[18%] sm:max-w-xl sm:translate-y-0"
      >
        <DialogTitle className="sr-only">Buscar no painel</DialogTitle>
        <SearchInput
          query={query}
          activeId={commands[activeIndex]?.id}
          onQueryChange={setQuery}
          onKeyDown={onKeyDown}
        />
        <CommandResults
          id={RESULTS_ID}
          commands={commands}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
          onChoose={choose}
        />
      </DialogContent>
    </Dialog>
  );
}
