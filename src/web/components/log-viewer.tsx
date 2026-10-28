import {
  ArrowDownIcon,
  CopyIcon,
  DownloadIcon,
  OctagonAlertIcon,
  RadioIcon,
  SearchIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { formatTime } from "@/shared/format";
import { classifyLogLevel, type LogLevel } from "@/shared/log-level";

import { StatusPill } from "./status-badge";
import { cn } from "./ui/class-names";

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

function linesAsText(lines: readonly LogLine[]): string {
  return lines.map((line) => `${line.createdAt} ${line.message}`).join("\n");
}

async function copyLines(lines: readonly LogLine[]): Promise<void> {
  try {
    await navigator.clipboard.writeText(linesAsText(lines));
    toast.success("Logs copiados");
  } catch {
    toast.error("Não foi possível copiar. Use Baixar para salvar os logs.");
  }
}

function downloadLines(lines: readonly LogLine[], fileName: string): void {
  const url = URL.createObjectURL(
    new Blob([linesAsText(lines)], { type: "text/plain;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Small text button of the console toolbar, styled for the always-dark console surface. */
function ToolbarButton({
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
      title={title}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-console-foreground/70 transition-colors hover:bg-white/8 hover:text-console-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5"
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </button>
  );
}

/** Scrollable, filterable log output that follows new lines until the user scrolls up. */
export function LogViewer({
  url,
  emptyMessage,
  onEnd,
  heightClass = "h-[28rem]",
  downloadName = "nelcota.log",
}: {
  readonly url: string;
  /** File name used by the "Baixar" button. */
  readonly downloadName?: string;
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

  const [highlightedId, setHighlightedId] = useState<number | null>(null);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    // Blank lines (common in BuildKit output) only add noise to the view.
    return lines.filter(
      (line) =>
        line.message.trim() !== "" &&
        (needle === "" || line.message.toLowerCase().includes(needle)),
    );
  }, [lines, filter]);
  const firstError = visible.find(
    (line) => (line.level ?? classifyLogLevel(line.message)) === "error",
  );

  const jumpToError = () => {
    if (firstError == null) {
      return;
    }
    setFollowing(false);
    setHighlightedId(firstError.id);
    containerRef.current
      ?.querySelector(`[data-line-id="${firstError.id}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (following && container != null) {
      container.scrollTop = container.scrollHeight;
    }
  }, [visible, following]);

  const pill = STATE_PILLS[state];
  return (
    <div className="overflow-hidden rounded-xl bg-console ring-1 ring-border/70">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/8 px-4 py-2.5">
        <StatusPill tone={pill.tone} label={pill.label} className="text-xs" />
        <span className="text-xs text-console-foreground/50 tabular-nums">
          {visible.length} linhas
        </span>
        <div className="ml-auto flex items-center gap-1">
          <div className="relative mr-1">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-console-foreground/40"
            />
            <input
              aria-label="Filtrar logs"
              placeholder="Filtrar"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="h-8 w-36 rounded-md bg-white/5 pr-2 pl-8 text-xs text-console-foreground placeholder:text-console-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-48"
            />
          </div>
          <ToolbarButton
            label="Ir para o erro"
            disabled={firstError == null}
            onClick={jumpToError}
            title={firstError == null ? "Nenhum erro nas linhas exibidas" : undefined}
          >
            <OctagonAlertIcon aria-hidden />
          </ToolbarButton>
          <ToolbarButton
            label="Copiar"
            disabled={visible.length === 0}
            onClick={() => void copyLines(visible)}
          >
            <CopyIcon aria-hidden />
          </ToolbarButton>
          <ToolbarButton
            label="Baixar"
            disabled={visible.length === 0}
            onClick={() => downloadLines(visible, downloadName)}
          >
            <DownloadIcon aria-hidden />
          </ToolbarButton>
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
          "overflow-auto px-4 py-3 font-mono text-xs leading-[1.7] text-console-foreground",
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
                data-line-id={line.id}
                className={cn(
                  "flex gap-3 whitespace-pre-wrap break-all",
                  line.id === highlightedId ? "-mx-2 rounded bg-destructive/20 px-2" : "",
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
        <div className="flex justify-end border-t border-white/8 px-4 py-2">
          <button
            type="button"
            onClick={() => setFollowing(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-console-foreground/80 transition-colors hover:bg-white/8 hover:text-console-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-3.5"
          >
            <ArrowDownIcon aria-hidden />
            Acompanhar novas linhas
          </button>
        </div>
      )}
    </div>
  );
}
