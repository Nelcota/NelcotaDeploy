import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, type LucideIcon } from "lucide-react";

import type { ApplicationFilter } from "@/web/components/projects/project-accent";
import { cn } from "@/web/components/ui/class-names";

const APPLICATION_FILTERS: readonly {
  readonly value: ApplicationFilter;
  readonly label: string;
  readonly icon: LucideIcon | null;
}[] = [
  { value: "all", label: "Todas", icon: null },
  { value: "online", label: "Online", icon: CircleCheckIcon },
  { value: "attention", label: "Precisam de atenção", icon: CircleAlertIcon },
  { value: "never-deployed", label: "Sem deploy", icon: CircleDashedIcon },
];

/** Pill-shaped radio group that narrows the application list by state. */
export function ApplicationFilterGroup({
  value,
  onChange,
}: {
  readonly value: ApplicationFilter;
  readonly onChange: (filter: ApplicationFilter) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Filtrar aplicações"
      className="-m-1 flex gap-2 overflow-x-auto p-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible"
    >
      {APPLICATION_FILTERS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            option.value === value
              ? "bg-primary text-primary-foreground"
              : "bg-well ring-1 ring-border hover:bg-well-hover",
          )}
        >
          {option.icon == null ? null : <option.icon aria-hidden className="size-4" />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
