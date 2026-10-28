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
      // On phones the options scroll sideways in one line instead of wrapping into a second row.
      className="-m-1 flex max-w-full items-center gap-2 overflow-x-auto p-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-9 shrink-0 rounded-full px-4 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none",
            option.value === value
              ? "bg-primary text-primary-foreground"
              : "bg-well text-foreground ring-1 ring-border hover:bg-well-hover",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
