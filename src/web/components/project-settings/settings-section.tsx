import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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
}: {
  readonly icon: LucideIcon;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** `danger` outlines the card in red, for actions that cannot be undone. */
  readonly tone?: keyof typeof SECTION_TONES;
  readonly children: ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl bg-card ring-1", SECTION_TONES[tone])}>
      <header className="flex items-start gap-3 border-b border-border/60 px-5 py-4 md:px-6">
        <Icon
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0",
            tone === "danger" ? "text-destructive" : "text-muted-foreground",
          )}
        />
        <div className="min-w-0 space-y-0.5">
          <h3 className={cn("text-sm font-semibold", tone === "danger" && "text-destructive")}>
            {title}
          </h3>
          {description == null ? null : (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </header>
      <div className="px-5 py-5 md:px-6">{children}</div>
    </section>
  );
}
