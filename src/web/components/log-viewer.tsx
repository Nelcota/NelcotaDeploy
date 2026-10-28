import { ArrowDownIcon, RadioIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatTime } from "@/shared/format";
import { classifyLogLevel, type LogLevel } from "@/shared/log-level";

import { StatusPill } from "./status-badge";
import { Button } from "./ui/button";
import { cn } from "./ui/class-names";
import { Input } from "./ui/input";

/** One line received from a log stream. */
type LogLine = {
  readonly id: number;
  readonly message: string;
  readonly createdAt: string;
  readonly stream: string;
  readonly level?: LogLevel;
};

type ConnectionState = "connecting" | "live" | "reconnecting" | "ended" | "error";

const MAX_LINES = 5000;
const SCROLL_BOTTOM_TOLERANCE_IN_PX = 24;

const LEVEL_CLASSES: Record<LogLevel, string> = {
  info: "text-console-foreground",
  warn: "text-[#f2b544]",
  error: "text-[#ff6b7a]",
};

const LEVEL_PREFIX: Record<LogLevel, string> = { info: "", warn: "AVISO", error: "ERRO" };

/**
 * Subscribes to a server-sent log stream. EventSource reconnects by itself and sends the
 * last received id, so the server resumes exactly where the stream stopped.
 */
function useLogStream(url: string) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [endSummary, setEndSummary] = useState<unknown>(null);

  useEffect(() => {
    setLines([]);
    setState("connecting");
    setEndSummary(null);
    const source = new EventSource(url, { withCredentials: true });
    source.addEventListener("open", () => setState("live"));
    source.addEventListener("log", (event) => {
      const line = JSON.parse(event.data as string) as LogLine;
      setLines((current) => {
        const next =
          current.length >= MAX_LINES ? current.slice(current.length - MAX_LINES + 1) : current;
        return [...next, line];
      });
    });
    source.addEventListener("end", (event) => {
      setEndSummary(JSON.parse(event.data as string));
      setState("ended");
      source.close();
    });
    source.addEventListener("error", () => {
      setState(source.readyState === EventSource.CLOSED ? "error" : "reconnecting");
    });
    return () => source.close();
  }, [url]);

  return { lines, state, endSummary };
}

const STATE_PILLS: Record<
  ConnectionState,
  { tone: "progress" | "success" | "warning" | "neutral" | "danger"; label: string }
> = {
  connecting: { tone: "progress", label: "Conectando" },
  live: { tone: "success", label: "Ao vivo" },
  reconnecting: { tone: "warning", label: "Reconectando" },
  ended: { tone: "neutral", label: "Finalizado" },
  error: { tone: "danger", label: "Desconectado" },
};

/** Scrollable, filterable log output that follows new lines until the user scrolls up. */
export function LogViewer({
  url,
  emptyMessage,
  onEnd,
  heightClass = "h-[28rem]",
}: {
  readonly url: string;
  readonly emptyMessage: string;
  readonly onEnd?: (summary: unknown) => void;
  readonly heightClass?: string;
}) {
  const { lines, state, endSummary } = useLogStream(url);
  const [filter, setFilter] = useState("");
  const [following, setFollowing] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => {
    if (state === "ended") {
      onEndRef.current?.(endSummary);
    }
  }, [state, endSummary]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle === ""
      ? lines
      : lines.filter((line) => line.message.toLowerCase().includes(needle));
  }, [lines, filter]);

  useEffect(() => {
    const container = containerRef.current;
    if (following && container != null) {
      container.scrollTop = container.scrollHeight;
    }
  }, [visible, following]);

  const pill = STATE_PILLS[state];
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <StatusPill tone={pill.tone} label={pill.label} />
        <span className="text-sm text-muted-foreground">{lines.length} linhas</span>
        <div className="relative ml-auto w-full sm:w-64">
          <SearchIcon
            aria-hidden
            className="absolute top-2.5 left-2.5 size-4 text-muted-foreground"
          />
          <Input
            aria-label="Filtrar logs"
            placeholder="Filtrar"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-10 pl-9"
          />
        </div>
      </div>
      <div
        ref={containerRef}
        role="log"
        aria-live="off"
        aria-label="Saída de logs"
        tabIndex={0}
        onScroll={(event) => {
          const target = event.currentTarget;
          setFollowing(
            target.scrollHeight - target.scrollTop - target.clientHeight <
              SCROLL_BOTTOM_TOLERANCE_IN_PX,
          );
        }}
        className={cn(
          "overflow-auto bg-console px-4 py-3 font-mono text-xs leading-[1.7] text-console-foreground",
          heightClass,
        )}
      >
        {visible.length === 0 ? (
          <p className="flex items-center gap-2 text-console-foreground/60">
            <RadioIcon aria-hidden className="size-3.5" />
            {emptyMessage}
          </p>
        ) : (
          visible.map((line) => {
            const level = line.level ?? classifyLogLevel(line.message);
            return (
              <div
                key={line.id}
                className={cn(
                  "flex gap-3 whitespace-pre-wrap break-all",
                  LEVEL_CLASSES[level],
                  line.stream === "system" ? "font-semibold" : "",
                )}
              >
                <time
                  className="shrink-0 text-console-foreground/40 tabular-nums select-none"
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
          })
        )}
      </div>
      {following ? null : (
        <div className="flex justify-end border-t px-4 py-3">
          <Button size="sm" variant="secondary" onClick={() => setFollowing(true)}>
            <ArrowDownIcon aria-hidden />
            Acompanhar novas linhas
          </Button>
        </div>
      )}
    </div>
  );
}
