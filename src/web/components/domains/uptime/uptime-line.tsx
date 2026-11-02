import { ActivityIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";

import { useNow } from "@/web/components/clock/use-now";
import { Tag } from "@/web/components/layout/layout";
import { cn } from "@/web/components/ui/class-names";

import { type DomainUptime, describeUptime } from "./uptime-state";

/** Availability of a domain as visitors see it: state, figures, recent checks, certificate. */
export function UptimeLine({ uptime }: { readonly uptime: DomainUptime }) {
  const now = useNow();
  const view = describeUptime(uptime, now);
  const upCount = uptime.recent.filter((check) => check.up).length;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      <Tag icon={ActivityIcon} tone={view.tone}>
        {view.label}
      </Tag>
      {uptime.recent.length === 0 ? null : (
        <span
          className="flex items-end gap-px"
          role="img"
          aria-label={`${upCount} de ${uptime.recent.length} checagens recentes responderam`}
        >
          {uptime.recent.map((check) => (
            <span
              key={check.checkedAt}
              className={cn("h-3 w-1 rounded-[1px]", check.up ? "bg-success" : "bg-destructive")}
            />
          ))}
        </span>
      )}
      {view.figures == null ? null : <span className="tabular-nums">{view.figures}</span>}
      {view.failure == null ? null : <span className="text-warning">{view.failure}</span>}
      {view.certificate == null ? null : (
        <span
          className={cn(
            "inline-flex items-center gap-1",
            view.certificate.expiring && "text-warning",
          )}
        >
          {view.certificate.expiring ? (
            <ShieldAlertIcon aria-hidden className="size-3.5" />
          ) : (
            <ShieldCheckIcon aria-hidden className="size-3.5" />
          )}
          {view.certificate.text}
        </span>
      )}
    </div>
  );
}
