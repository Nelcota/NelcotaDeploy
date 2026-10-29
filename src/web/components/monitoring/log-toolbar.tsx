import { CopyIcon, DownloadIcon, OctagonAlertIcon, SearchIcon } from "lucide-react";
import type { ReactNode } from "react";

import { copyLines, downloadLines } from "@/web/components/monitoring/log-export";
import type { LogLevelFilter } from "@/web/components/monitoring/log-filter";
import { LEVEL_CLASSES } from "@/web/components/monitoring/log-lines";
import type { LogLine } from "@/web/components/monitoring/log-stream";
import type { LogFilters } from "@/web/components/monitoring/use-log-filters";
import { cn } from "@/web/components/ui/class-names";

const LEVEL_FILTERS = [
  { value: "all", label: "Tudo" },
  { value: "warn", label: "Avisos" },
  { value: "error", label: "Erros" },
] as const satisfies readonly { readonly value: LogLevelFilter; readonly label: string }[];

/** Small text button of the console toolbar, styled for the always-dark console surface. */
export function ToolbarButton({
  label,
  title,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly title?: string | undefined;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      className="inline-flex h-9 items-center sm:h-8 gap-1.5 rounded-md px-2.5 text-xs font-medium text-console-foreground/70 transition-colors hover:bg-white/8 hover:text-console-foreground focus-visible:ring-2 focus-visible:ring-console-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5"
    >
      {children}
      <span className="hidden xl:inline">{label}</span>
      <span className="sr-only xl:hidden">{label}</span>
    </button>
  );
}

function SearchField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="relative min-w-0 lg:max-w-sm lg:flex-1">
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-console-foreground/65"
      />
      <input
        type="search"
        aria-label="Filtrar logs"
        placeholder="Filtrar linhas"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md bg-white/5 pr-2 pl-8 text-base text-console-foreground placeholder:text-console-foreground/65 focus-visible:ring-2 focus-visible:ring-console-ring focus-visible:outline-none sm:text-sm"
      />
    </div>
  );
}

function LevelFilterGroup({
  value,
  counts,
  onChange,
}: {
  readonly value: LogLevelFilter;
  readonly counts: { readonly warnings: number; readonly errors: number };
  readonly onChange: (value: LogLevelFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filtrar por nível"
      className="flex h-9 shrink-0 items-center gap-0.5 rounded-md bg-white/5 p-0.5"
    >
      {LEVEL_FILTERS.map((option) => {
        const count = option.value === "error" ? counts.errors : counts.warnings;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-console-foreground/65 transition-colors hover:text-console-foreground focus-visible:ring-2 focus-visible:ring-console-ring focus-visible:outline-none",
              value === option.value ? "bg-white/10 text-console-foreground" : "",
            )}
          >
            {option.label}
            {option.value === "all" || count === 0 ? null : (
              <span className={cn("tabular-nums", LEVEL_CLASSES[option.value])}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function LineActions({
  visible,
  hasError,
  downloadName,
  onJumpToError,
}: {
  readonly visible: readonly LogLine[];
  readonly hasError: boolean;
  readonly downloadName: string;
  readonly onJumpToError: () => void;
}) {
  const empty = visible.length === 0;
  return (
    <div className="flex items-center gap-1">
      <ToolbarButton
        label="Ir para o erro"
        disabled={hasError === false}
        onClick={onJumpToError}
        title={hasError ? undefined : "Nenhum erro nas linhas exibidas"}
      >
        <OctagonAlertIcon aria-hidden />
      </ToolbarButton>
      <ToolbarButton label="Copiar" disabled={empty} onClick={() => void copyLines(visible)}>
        <CopyIcon aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Baixar"
        disabled={empty}
        onClick={() => downloadLines(visible, downloadName)}
      >
        <DownloadIcon aria-hidden />
      </ToolbarButton>
    </div>
  );
}

type LogToolbarProps = {
  readonly toolbarStart: ReactNode;
  readonly filters: LogFilters;
  readonly hasError: boolean;
  readonly downloadName: string;
  readonly onJumpToError: () => void;
};

/** Search, level filter and line actions above the console. */
export function LogToolbar({
  toolbarStart,
  filters,
  hasError,
  downloadName,
  onJumpToError,
}: LogToolbarProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-white/8 p-2.5 lg:flex-row lg:items-center">
      {toolbarStart == null ? null : (
        <div className="min-w-0 lg:w-72 lg:shrink-0">{toolbarStart}</div>
      )}
      <SearchField value={filters.search} onChange={filters.setSearch} />
      <div className="flex items-center justify-between gap-2 lg:ml-auto lg:justify-end">
        <LevelFilterGroup
          value={filters.levelFilter}
          counts={filters.counts}
          onChange={filters.setLevelFilter}
        />
        <LineActions
          visible={filters.visible}
          hasError={hasError}
          downloadName={downloadName}
          onJumpToError={onJumpToError}
        />
      </div>
    </div>
  );
}
