import { LoaderCircleIcon, SaveIcon, Undo2Icon } from "lucide-react";

import { Button } from "@/web/components/ui/button";

/** Sticky bar shown while the form has unsaved changes, with discard and save buttons. */
export function UnsavedChangesBar({
  formId,
  canEdit,
  isSubmitting,
  onDiscard,
}: {
  /** Id of the form the save button submits; the bar sits outside it. */
  readonly formId: string;
  readonly canEdit: boolean;
  readonly isSubmitting: boolean;
  readonly onDiscard: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-lg bg-popover p-3 shadow-lg ring-1 ring-border sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium" aria-live="polite">
        Alterações não salvas
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={onDiscard}>
          <Undo2Icon aria-hidden />
          Descartar
        </Button>
        <Button type="submit" form={formId} disabled={canEdit === false || isSubmitting}>
          {isSubmitting ? (
            <LoaderCircleIcon aria-hidden className="animate-spin" />
          ) : (
            <SaveIcon aria-hidden />
          )}
          Salvar alterações
        </Button>
      </div>
    </div>
  );
}
