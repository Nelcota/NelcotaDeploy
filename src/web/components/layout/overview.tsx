import { RadioGroup } from "radix-ui";

import { cn } from "@/web/components/ui/class-names";

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
    <RadioGroup.Root
      value={String(value)}
      onValueChange={(next) => {
        const option = options.find((candidate) => String(candidate.value) === next);
        if (option == null) {
          throw new RangeError(`Invalid segmented control value: ${next}`);
        }
        onChange(option.value);
      }}
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== "Home" && event.key !== "End") {
          return;
        }
        // Radix moves focus; retain the control's automatic selection for these two keys.
        const option = event.key === "Home" ? options.at(0) : options.at(-1);
        if (option != null) {
          onChange(option.value);
        }
      }}
      // On phones the options scroll sideways in one line instead of wrapping into a second
      // row. Elsewhere the group keeps its natural width, so it never squeezes into a column.
      className="flex max-w-full shrink-0 items-center gap-2 max-sm:-m-1 max-sm:shrink max-sm:overflow-x-auto max-sm:p-1 max-sm:[scrollbar-width:none]"
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={String(option.value)}
          value={String(option.value)}
          className={cn(
            "h-9 shrink-0 rounded-full px-4 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none",
            option.value === value
              ? "bg-primary text-primary-foreground"
              : "bg-well text-foreground ring-1 ring-border hover:bg-well-hover",
          )}
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
