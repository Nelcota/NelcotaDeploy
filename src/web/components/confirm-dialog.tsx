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
} from "./ui/alert-dialog";
import { buttonVariants } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/**
 * Asks for confirmation before a dangerous action. With `confirmationText`, the user must
 * type it to enable the action.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  confirmationText,
  onConfirm,
}: {
  readonly trigger: ReactNode;
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly destructive?: boolean;
  readonly confirmationText?: string;
  readonly onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const blocked = confirmationText != null && typed !== confirmationText;
  return (
    <AlertDialog onOpenChange={() => setTyped("")}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirmationText == null ? null : (
          <div className="space-y-2">
            <Label htmlFor="confirmation-text">
              Digite <span className="font-mono font-semibold">{confirmationText}</span> para
              confirmar
            </Label>
            <Input
              id="confirmation-text"
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
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
