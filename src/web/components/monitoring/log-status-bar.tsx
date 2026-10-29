import { ArrowDownIcon, RotateCwIcon } from "lucide-react";

import { pluralize } from "@/shared/format";
import { StatusPill } from "@/web/components/layout/status-badge";
import type { ConnectionState } from "@/web/components/monitoring/log-stream";
import { ToolbarButton } from "@/web/components/monitoring/log-toolbar";

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

function lineCountText(filtering: boolean, visibleCount: number, receivedCount: number): string {
  if (filtering) {
    return `${visibleCount} de ${pluralize(receivedCount, "linha", "linhas")}`;
  }
  return pluralize(visibleCount, "linha", "linhas");
}

type LogStatusBarProps = {
  readonly state: ConnectionState;
  readonly filtering: boolean;
  readonly visibleCount: number;
  readonly receivedCount: number;
  readonly following: boolean;
  readonly onReconnect: () => void;
  readonly onFollow: () => void;
};

/** Connection state, line count and the "follow new lines" button under the console. */
export function LogStatusBar({
  state,
  filtering,
  visibleCount,
  receivedCount,
  following,
  onReconnect,
  onFollow,
}: LogStatusBarProps) {
  const pill = STATE_PILLS[state];
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/8 px-3 py-1.5 text-xs">
      <span role="status">
        <StatusPill tone={pill.tone} label={pill.label} className="text-xs" />
      </span>
      {state === "error" ? (
        <ToolbarButton label="Reconectar" disabled={false} onClick={onReconnect}>
          <RotateCwIcon aria-hidden />
        </ToolbarButton>
      ) : null}
      <span className="text-console-foreground/65 tabular-nums">
        {lineCountText(filtering, visibleCount, receivedCount)}
      </span>
      {following ? null : (
        <button
          type="button"
          onClick={onFollow}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 font-medium text-console-foreground/80 transition-colors hover:bg-white/8 hover:text-console-foreground focus-visible:ring-2 focus-visible:ring-console-ring focus-visible:outline-none [&_svg]:size-3.5"
        >
          <ArrowDownIcon aria-hidden />
          Acompanhar novas linhas
        </button>
      )}
    </div>
  );
}
