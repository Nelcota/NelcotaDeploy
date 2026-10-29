import { LoaderCircleIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/web/components/ui/button";
import { DialogFooter } from "@/web/components/ui/dialog";

/** Cancel and submit buttons of a dialog form; the submit button spins while it is pending. */
export function DialogFormFooter({
  submitLabel,
  isPending,
  onCancel,
  idleIcon = null,
}: {
  readonly submitLabel: string;
  readonly isPending: boolean;
  readonly onCancel: () => void;
  /** Icon shown on the submit button while nothing is pending. */
  readonly idleIcon?: ReactNode;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancelar
      </Button>
      <Button type="submit" disabled={isPending}>
        {isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : idleIcon}
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}
