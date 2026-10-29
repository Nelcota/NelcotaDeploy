import { EyeIcon, LockIcon } from "lucide-react";
import type { KeyboardEvent } from "react";

import { cn } from "@/web/components/ui/class-names";

export type VariableKind = "plain" | "secret";

const OPTIONS = [
  { value: "plain", label: "Configuração", hint: "valor visível", icon: EyeIcon },
  { value: "secret", label: "Secret", hint: "criptografado", icon: LockIcon },
] as const;

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

function KindOption({
  option,
  selected,
  onSelect,
}: {
  readonly option: (typeof OPTIONS)[number];
  readonly selected: boolean;
  readonly onSelect: (value: VariableKind) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      data-value={option.value}
      tabIndex={selected ? 0 : -1}
      title={option.hint}
      aria-checked={selected}
      onClick={() => onSelect(option.value)}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
        selected
          ? "bg-card text-foreground ring-1 ring-border"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <option.icon aria-hidden className="size-4" />
      {option.label}
    </button>
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
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (ARROW_KEYS.has(event.key) === false) {
      return;
    }
    event.preventDefault();
    const next: VariableKind = value === "plain" ? "secret" : "plain";
    onChange(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
  };
  return (
    <div
      id={id}
      role="radiogroup"
      aria-labelledby={`${id}-label`}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1 ring-1 ring-border ring-inset"
    >
      {OPTIONS.map((option) => (
        <KindOption
          key={option.value}
          option={option}
          selected={value === option.value}
          onSelect={onChange}
        />
      ))}
    </div>
  );
}
