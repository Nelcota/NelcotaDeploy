import type { LucideIcon } from "lucide-react";
import { type ReactNode, useId } from "react";

import { cn } from "@/web/components/ui/class-names";

const SECTION_TONES = {
  default: "ring-border/70",
  danger: "ring-destructive/35",
} as const;

/**
 * One card of a settings page: a header with the title and what the section is for, then its
 * controls across the full width.
 */
export function SettingsSection({
  icon: Icon,
  title,
  description,
  tone = "default",
  children,
  id,
}: {
  readonly icon: LucideIcon;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** `danger` outlines the card in red, for actions that cannot be undone. */
  readonly tone?: keyof typeof SECTION_TONES;
  readonly children: ReactNode;
  readonly id?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      tabIndex={id == null ? undefined : -1}
      aria-labelledby={headingId}
      className={cn(
        "scroll-mt-4 rounded-xl bg-card ring-1 focus-visible:outline-2 focus-visible:outline-ring",
        SECTION_TONES[tone],
      )}
    >
      <header className="flex items-start gap-3 border-b border-border/60 px-4 py-3 md:px-5">
        <Icon
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0",
            tone === "danger" ? "text-destructive" : "text-muted-foreground",
          )}
        />
        <div className="min-w-0 space-y-0.5">
          <h3
            id={headingId}
            className={cn("text-sm font-semibold", tone === "danger" && "text-destructive")}
          >
            {title}
          </h3>
          {description == null ? null : (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </header>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}
