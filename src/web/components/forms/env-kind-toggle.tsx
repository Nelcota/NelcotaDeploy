import { EyeIcon, LockIcon } from "lucide-react";
import { RadioGroup } from "radix-ui";

export type VariableKind = "plain" | "secret";

const OPTIONS = [
  { value: "plain", label: "Configuração", hint: "valor visível", icon: EyeIcon },
  { value: "secret", label: "Secret", hint: "criptografado", icon: LockIcon },
] as const;

function KindOption({ option }: { readonly option: (typeof OPTIONS)[number] }) {
  return (
    <RadioGroup.Item
      value={option.value}
      title={option.hint}
      className="flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none data-[state=checked]:bg-card data-[state=checked]:text-foreground data-[state=checked]:ring-1 data-[state=checked]:ring-border"
    >
      <option.icon aria-hidden className="size-4" />
      {option.label}
    </RadioGroup.Item>
  );
}

/**
 * Two-option switch between a visible configuration value and an encrypted secret. Behaves
 * like a radio group: one Tab stop, and the arrow keys move the choice.
 */
export function VariableKindToggle({
  id,
  value,
  onChange,
  describedBy,
}: {
  readonly id: string;
  readonly value: VariableKind;
  readonly onChange: (value: VariableKind) => void;
  /** Ids of the hint and error text, as given by a form field. */
  readonly describedBy?: string;
}) {
  return (
    <RadioGroup.Root
      id={id}
      value={value}
      onValueChange={(next) => {
        if (next !== "plain" && next !== "secret") {
          throw new RangeError(`Invalid variable kind: ${next}`);
        }
        onChange(next);
      }}
      aria-labelledby={`${id}-label`}
      aria-describedby={describedBy}
      className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1 ring-1 ring-border ring-inset"
    >
      {OPTIONS.map((option) => (
        <KindOption key={option.value} option={option} />
      ))}
    </RadioGroup.Root>
  );
}
