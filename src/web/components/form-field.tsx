import type { ReactNode } from "react";

import { Label } from "./ui/label";

/** Extracts readable messages from TanStack Form / Zod errors. */
export function errorMessages(errors: readonly unknown[]): string[] {
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
 * Errors worth showing for a field: only once the user left it or tried to submit, so a
 * half-typed form is not covered in red.
 *
 * @param form - Anything exposing the form's submission count, such as a TanStack form.
 * @param meta - The field's blur state and current errors.
 * @returns The errors to display, or none yet.
 */
export function visibleErrors(
  form: { readonly state: { readonly submissionAttempts: number } },
  meta: { readonly isBlurred: boolean; readonly errors: readonly unknown[] },
): readonly unknown[] {
  return meta.isBlurred || form.state.submissionAttempts > 0 ? meta.errors : [];
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
    <div className="space-y-1.5">
      <Label id={`${id}-label`} htmlFor={id}>
        {label}
      </Label>
      {children({
        id,
        "aria-describedby": hint == null ? errorId : `${hintId} ${errorId}`,
        "aria-invalid": messages.length > 0,
      })}
      {hint == null ? null : (
        <p id={hintId} className="text-xs leading-relaxed text-faint">
          {hint}
        </p>
      )}
      <p
        id={errorId}
        aria-live="polite"
        className="text-xs font-medium text-destructive empty:hidden"
      >
        {messages[0] ?? ""}
      </p>
    </div>
  );
}
