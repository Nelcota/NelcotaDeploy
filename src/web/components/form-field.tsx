import type { ReactNode } from "react";

import { Label } from "./ui/label";

/** Extracts readable messages from TanStack Form / Zod errors. */
function errorMessages(errors: readonly unknown[]): string[] {
  return errors
    .map((error) => {
      if (typeof error === "string") {
        return error;
      }
      if (
        typeof error === "object" &&
        error != null &&
        "message" in error &&
        typeof error.message === "string"
      ) {
        return error.message;
      }
      return "";
    })
    .filter((message) => message !== "");
}

/**
 * Label, control, hint and error message wired together for screen readers: the control
 * gets `aria-describedby` pointing at the hint and the error.
 */
export function FormField({
  id,
  label,
  hint,
  errors = [],
  children,
}: {
  readonly id: string;
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly errors?: readonly unknown[];
  readonly children: (props: {
    id: string;
    "aria-describedby": string;
    "aria-invalid": boolean;
  }) => ReactNode;
}) {
  const messages = errorMessages(errors);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-describedby": `${hintId} ${errorId}`,
        "aria-invalid": messages.length > 0,
      })}
      {hint == null ? null : (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <p id={errorId} aria-live="polite" className="text-xs text-destructive">
        {messages[0] ?? ""}
      </p>
    </div>
  );
}
