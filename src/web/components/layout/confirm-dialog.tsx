import { type ReactNode, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/web/components/ui/alert-dialog";
import { buttonVariants } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

/**
 * Asks for confirmation before a dangerous action. With `confirmationText`, the user must
 * type it to enable the action.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  destructive = false,
  confirmationText,
  onConfirm,
  open,
  onOpenChange,
}: {
  /** Element that opens the dialog; omit when `open` is controlled by the caller. */
  readonly trigger?: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  /** Label of the button that closes without acting; rename it when "Cancelar" is ambiguous. */
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly confirmationText?: string;
  readonly onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const blocked = confirmationText != null && typed !== confirmationText;
  return (
    <AlertDialog
      {...(open == null ? {} : { open })}
      onOpenChange={(next) => {
        setTyped("");
        onOpenChange?.(next);
      }}
    >
      {trigger == null ? null : <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent className="border-0 shadow-lg ring-1 ring-border">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirmationText == null ? null : (
          <div className="space-y-1.5">
            <Label htmlFor="confirmation-text" className="font-normal text-muted-foreground">
              Digite{" "}
              <span className="font-mono font-semibold text-foreground">{confirmationText}</span>{" "}
              para confirmar
            </Label>
            <Input
              id="confirmation-text"
              value={typed}
              autoComplete="off"
              className="font-mono"
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={blocked}
            className={destructive ? buttonVariants({ variant: "destructive" }) : undefined}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
