import { cn } from "./ui/class-names";

/** Pill toggle between a few options, such as "1 h / 24 h" or list filters. */
export function SegmentedControl<TValue extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly { readonly value: TValue; readonly label: string }[];
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-well p-1 ring-1 ring-border/40"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 shrink-0 rounded-full px-3.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            option.value === value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
