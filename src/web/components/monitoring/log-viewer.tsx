import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { levelOf } from "@/web/components/monitoring/log-filter";
import { LogOutput } from "@/web/components/monitoring/log-lines";
import { LogStatusBar } from "@/web/components/monitoring/log-status-bar";
import { type LogLine, useLogStream } from "@/web/components/monitoring/log-stream";
import { LogToolbar } from "@/web/components/monitoring/log-toolbar";
import { useLogFilters } from "@/web/components/monitoring/use-log-filters";

/** Keeps the newest line in view while `following`, and scrolls to a chosen line. */
function useLogScroll(visible: readonly LogLine[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (following && container != null) {
      container.scrollTop = container.scrollHeight;
    }
  }, [visible, following]);

  const showLine = (line: LogLine | undefined) => {
    if (line == null) {
      return;
    }
    setFollowing(false);
    setHighlightedId(line.id);
    containerRef.current
      ?.querySelector(`[data-line-id="${line.id}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return { containerRef, following, setFollowing, highlightedId, showLine };
}

/** Calls `onEnd` once the stream reports its end. */
function useStreamEnd(state: string, endSummary: unknown, onEnd?: (summary: unknown) => void) {
  const handleEnd = useEffectEvent((summary: unknown) => onEnd?.(summary));
  useEffect(() => {
    if (state === "ended") {
      handleEnd(endSummary);
    }
  }, [state, endSummary]);
}

type LogViewerProps = {
  readonly url: string;
  /** Extra control at the start of the toolbar, such as a choice of what to stream. */
  readonly toolbarStart?: ReactNode;
  /** File name used by the "Baixar" button. */
  readonly downloadName?: string;
  readonly emptyMessage: string;
  readonly onEnd?: (summary: unknown) => void;
  readonly heightClass?: string;
};

/** Scrollable, filterable log output that follows new lines until the user scrolls up. */
export function LogViewer({
  url,
  emptyMessage,
  onEnd,
  heightClass = "h-[28rem]",
  downloadName = "nelcota.log",
  toolbarStart,
}: LogViewerProps) {
  const [attempt, setAttempt] = useState(0);
  const { lines, state, endSummary } = useLogStream(url, attempt);
  useStreamEnd(state, endSummary, onEnd);
  const filters = useLogFilters(lines);
  const scroll = useLogScroll(filters.visible);
  const firstError = filters.visible.find((line) => levelOf(line) === "error");

  return (
    // The console is dark in both themes; the dark palette keeps its pills and text readable.
    <div className="dark flex flex-col overflow-hidden rounded-xl bg-console ring-1 ring-border/70">
      <LogToolbar
        toolbarStart={toolbarStart}
        filters={filters}
        hasError={firstError != null}
        downloadName={downloadName}
        onJumpToError={() => scroll.showLine(firstError)}
      />
      <LogOutput
        containerRef={scroll.containerRef}
        visible={filters.visible}
        receivedCount={lines.length}
        filtering={filters.filtering}
        highlightedId={scroll.highlightedId}
        emptyMessage={emptyMessage}
        heightClass={heightClass}
        onFollowingChange={scroll.setFollowing}
        onClearFilters={filters.clearFilters}
      />
      <LogStatusBar
        state={state}
        filtering={filters.filtering}
        visibleCount={filters.visible.length}
        receivedCount={lines.length}
        following={scroll.following}
        onReconnect={() => setAttempt((current) => current + 1)}
        onFollow={() => scroll.setFollowing(true)}
      />
    </div>
  );
}
