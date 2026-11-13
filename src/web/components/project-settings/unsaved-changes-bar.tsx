import { LoaderCircleIcon } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import { cn } from "@/web/components/ui/class-names";

/** Keeps save and discard in reach when the settings form has changes. */
export function UnsavedChangesBar({
  formId,
  changed,
  isSubmitting,
  onDiscard,
}: {
  /** Id of the form the save button submits; the bar sits outside it. */
  readonly formId: string;
  readonly changed: boolean;
  readonly isSubmitting: boolean;
  readonly onDiscard: () => void;
}) {
  const disabled = changed === false || isSubmitting;
  return (
    <div
      className={cn(
        "mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-popover p-2.5",
        changed && "sticky bottom-0 z-10 shadow-lg",
      )}
    >
      <p role="status" className="min-w-0 flex-1 basis-40 text-sm font-medium empty:sr-only">
        {changed ? "Alterações não salvas" : ""}
      </p>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={disabled}
          onClick={onDiscard}
        >
          Descartar
        </Button>
        <Button type="submit" form={formId} className="min-h-11" disabled={disabled}>
          {isSubmitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
          {isSubmitting ? "Salvando…" : "Salvar alterações"}
        </Button>
      </div>
    </div>
  );
}
