import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One block of the settings page: title and explanation on the left, controls on the right;
 * stacked on narrow screens.
 */
export function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  readonly icon: LucideIcon;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid gap-5 p-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-10 md:p-6">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </h3>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
