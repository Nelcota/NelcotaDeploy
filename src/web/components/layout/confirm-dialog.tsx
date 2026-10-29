import { CircleHelpIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/web/components/ui/alert-dialog";
import { cn } from "@/web/components/ui/class-names";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

function ConfirmationInput({
  expected,
  typed,
  onType,
}: {
  readonly expected: string;
  readonly typed: string;
  readonly onType: (typed: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="confirmation-text" className="font-normal text-muted-foreground">
        Digite <span className="font-mono font-semibold text-foreground">{expected}</span> para
        confirmar
      </Label>
      <Input
        id="confirmation-text"
        value={typed}
        autoComplete="off"
        className="font-mono"
        onChange={(event) => onType(event.target.value)}
      />
    </div>
  );
}

/** Title and description beside a warning (destructive) or question icon. */
function ConfirmHeading({
  title,
  description,
  destructive,
}: {
  readonly title: string;
  readonly description: ReactNode;
  readonly destructive: boolean;
}) {
  return (
    <div className="flex items-start gap-4">
      <span
        aria-hidden
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5",
          destructive ? "bg-destructive/12 text-destructive" : "bg-brand/12 text-brand",
        )}
      >
        {destructive ? <TriangleAlertIcon /> : <CircleHelpIcon />}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div>{description}</div>
        </AlertDialogDescription>
      </div>
    </div>
  );
}

type ConfirmDialogProps = {
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
};

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
}: ConfirmDialogProps) {
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
      <AlertDialogContent>
        <ConfirmHeading title={title} description={description} destructive={destructive} />
        {confirmationText == null ? null : (
          <ConfirmationInput expected={confirmationText} typed={typed} onType={setTyped} />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          {/* The variant, not a className: Slot would keep both colors and blue would win. */}
          <AlertDialogAction
            disabled={blocked}
            variant={destructive ? "destructive" : "default"}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
