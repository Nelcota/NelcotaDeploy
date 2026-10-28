import { EyeIcon, LockIcon } from "lucide-react";

import { cn } from "./ui/class-names";

export type VariableKind = "plain" | "secret";

const OPTIONS = [
  { value: "plain", label: "Configuração", hint: "valor visível", icon: EyeIcon },
  { value: "secret", label: "Secret", hint: "criptografado", icon: LockIcon },
] as const;

/** Two-option switch between a visible configuration value and an encrypted secret. */
export function VariableKindToggle({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: VariableKind;
  readonly onChange: (value: VariableKind) => void;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="Tipo"
      className="grid grid-cols-2 gap-1 rounded-lg border bg-surface-sunken p-1"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          title={option.hint}
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
            value === option.value
              ? "bg-surface-raised text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <option.icon aria-hidden className="size-4" />
          {option.label}
        </button>
      ))}
    </div>
  );
}
