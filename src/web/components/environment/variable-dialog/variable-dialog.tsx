import { LoaderCircleIcon } from "lucide-react";

import type { EnvironmentVariableView } from "@/environments";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

import { useVariableForm } from "./use-variable-form";
import { BuildSwitch, KeyField, KindField, ValueField } from "./variable-fields";

/** Creates a variable, or edits one when `variable` is given. */
export function VariableDialog({
  projectId,
  open,
  onOpenChange,
  variable,
  onSaved,
}: {
  readonly projectId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly variable: EnvironmentVariableView | null;
  readonly onSaved: () => void;
}) {
  const { form, save } = useVariableForm({
    projectId,
    variable,
    onSaved: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <VariableDialogHeader variable={variable} />
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <KeyField form={form} locked={variable != null} />
          <KindField form={form} />
          <ValueField form={form} savedSecret={variable?.kind === "secret"} />
          <BuildSwitch form={form} />
          <VariableDialogFooter isPending={save.isPending} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VariableDialogHeader({ variable }: { readonly variable: EnvironmentVariableView | null }) {
  return (
    <DialogHeader>
      <DialogTitle>{variable == null ? "Nova variável" : `Editar ${variable.key}`}</DialogTitle>
      <DialogDescription>
        O nome vira maiúsculo automaticamente; use letras, números e _.
      </DialogDescription>
    </DialogHeader>
  );
}

function VariableDialogFooter({
  isPending,
  onCancel,
}: {
  readonly isPending: boolean;
  readonly onCancel: () => void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancelar
      </Button>
      <Button type="submit" disabled={isPending}>
        {isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
        Salvar
      </Button>
    </DialogFooter>
  );
}
