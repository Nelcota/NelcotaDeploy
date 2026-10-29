import { RadioIcon } from "lucide-react";
import type { RefObject } from "react";

import { formatTime } from "@/shared/format";
import type { LogLevel } from "@/shared/log-level";
import { levelOf } from "@/web/components/monitoring/log-filter";
import type { LogLine } from "@/web/components/monitoring/log-stream";
import { cn } from "@/web/components/ui/class-names";

const SCROLL_BOTTOM_TOLERANCE_IN_PX = 24;

/** Text color of each severity on the console surface. */
export const LEVEL_CLASSES: Record<LogLevel, string> = {
  info: "text-console-foreground",
  warn: "text-[#f2b544]",
  error: "text-[#ff6b7a]",
};

const LEVEL_PREFIX: Record<LogLevel, string> = { info: "", warn: "AVISO", error: "ERRO" };

function LogLineRow({
  line,
  highlighted,
}: {
  readonly line: LogLine;
  readonly highlighted: boolean;
}) {
  const level = levelOf(line);
  return (
    <div
      data-line-id={line.id}
      className={cn(
        "flex gap-3 whitespace-pre-wrap [overflow-wrap:anywhere]",
        highlighted ? "-mx-2 rounded bg-destructive/20 px-2" : "",
        LEVEL_CLASSES[level],
        line.stream === "system" ? "font-semibold" : "",
      )}
    >
      <time
        className="shrink-0 text-console-foreground/65 tabular-nums select-none"
        dateTime={line.createdAt}
      >
        {formatTime(line.createdAt)}
      </time>
      {LEVEL_PREFIX[level] === "" ? null : (
        <span className="shrink-0">[{LEVEL_PREFIX[level]}]</span>
      )}
      <span>{line.message}</span>
    </div>
  );
}

function NoMatches({ onClearFilters }: { readonly onClearFilters: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-3 font-sans text-sm text-console-foreground/80">
      Nenhuma linha corresponde aos filtros.
      <button
        type="button"
        onClick={onClearFilters}
        className="rounded-md px-2 py-1 font-medium text-console-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-console-ring focus-visible:outline-none"
      >
        Limpar filtros
      </button>
    </p>
  );
}

function EmptyLog({ message }: { readonly message: string }) {
  return (
    <p className="flex items-center gap-2 font-sans text-sm text-console-foreground/80">
      <RadioIcon aria-hidden className="size-3.5" />
      {message}
    </p>
  );
}

type LogOutputProps = {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly visible: readonly LogLine[];
  readonly receivedCount: number;
  readonly filtering: boolean;
  readonly highlightedId: number | null;
  readonly emptyMessage: string;
  readonly heightClass: string;
  readonly onFollowingChange: (following: boolean) => void;
  readonly onClearFilters: () => void;
};

/** Scrolling list of the visible lines, with the empty and no-match messages. */
export function LogOutput({
  containerRef,
  visible,
  receivedCount,
  filtering,
  highlightedId,
  emptyMessage,
  heightClass,
  onFollowingChange,
  onClearFilters,
}: LogOutputProps) {
  const empty = visible.length === 0;
  return (
    <div
      ref={containerRef}
      role="log"
      aria-live="off"
      aria-label="Saída de logs"
      tabIndex={0}
      onScroll={(event) => {
        const target = event.currentTarget;
        const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
        onFollowingChange(distanceToBottom < SCROLL_BOTTOM_TOLERANCE_IN_PX);
      }}
      className={cn(
        "overflow-auto px-4 py-3 font-mono text-xs leading-[1.7] text-console-foreground focus-visible:ring-2 focus-visible:ring-console-ring focus-visible:outline-none focus-visible:ring-inset",
        heightClass,
      )}
    >
      {empty && receivedCount > 0 && filtering ? (
        <NoMatches onClearFilters={onClearFilters} />
      ) : null}
      {empty && (receivedCount === 0 || filtering === false) ? (
        <EmptyLog message={emptyMessage} />
      ) : null}
      {visible.map((line) => (
        <LogLineRow key={line.id} line={line} highlighted={line.id === highlightedId} />
      ))}
    </div>
  );
}
