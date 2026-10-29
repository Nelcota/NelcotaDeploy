import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ActivityIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { describeSystemStatus, SYSTEM_STATUS_DOTS } from "@/web/components/shell/system-status";
import { useSystemStatus } from "@/web/components/shell/use-shell-queries";
import { cn } from "@/web/components/ui/class-names";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";

const ROUND_ICON_BUTTON =
  "relative flex size-10 shrink-0 items-center justify-center rounded-full bg-well text-muted-foreground ring-1 ring-border transition-colors hover:bg-well-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Wide search field look-alike that opens the command palette. */
export function SearchButton({ onSearch }: { readonly onSearch: () => void }) {
  return (
    <button
      type="button"
      onClick={onSearch}
      aria-label="Buscar projetos e páginas"
      className="flex size-10 shrink-0 items-center justify-center gap-3 rounded-full bg-well text-sm text-muted-foreground ring-1 ring-border transition-colors hover:bg-well-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-auto sm:min-w-0 sm:max-w-md sm:flex-1 sm:shrink sm:justify-start sm:px-4"
    >
      <SearchIcon aria-hidden className="size-4 shrink-0" />
      <span className="hidden truncate sm:inline 2xl:hidden">Buscar…</span>
      <span className="hidden truncate 2xl:inline">Buscar projetos e páginas</span>
      <kbd className="ml-auto hidden rounded border border-border px-1.5 font-mono text-xs whitespace-nowrap text-faint sm:inline">
        Ctrl K
      </kbd>
    </button>
  );
}

/** Refetches every query on the page. */
export function RefreshButton() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
    } catch (error) {
      console.error("failed to refresh queries", error);
      toast.error("Não foi possível atualizar. Tente novamente.");
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Atualizar dados"
          onClick={() => void refresh()}
          className={ROUND_ICON_BUTTON}
        >
          <RefreshCwIcon aria-hidden className={cn("size-4", refreshing ? "animate-spin" : "")} />
        </button>
      </TooltipTrigger>
      <TooltipContent>Atualizar dados</TooltipContent>
    </Tooltip>
  );
}

/** Worker and Docker health in one icon; the badge color and the tooltip tell the state. */
export function SystemStatusButton() {
  const status = useSystemStatus();
  const worker = status.data?.worker ?? null;
  const { label, tone } = describeSystemStatus({
    pending: status.isPending,
    failed: status.isError,
    worker,
    activeDeployments: status.data?.activeDeployments ?? 0,
  });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/settings"
          search={{ tab: "server" }}
          aria-label={label}
          className={ROUND_ICON_BUTTON}
        >
          <ActivityIcon aria-hidden className="size-4" />
          <span
            aria-hidden
            className={cn(
              "absolute -top-0.5 -right-0.5 size-3 rounded-full ring-2 ring-background",
              SYSTEM_STATUS_DOTS[tone],
            )}
          />
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {worker?.dockerVersion == null ? "" : ` · Docker ${worker.dockerVersion}`}
      </TooltipContent>
    </Tooltip>
  );
}
