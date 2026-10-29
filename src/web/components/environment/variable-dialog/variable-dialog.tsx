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
import { KeyField, ValueField, VariableOptions } from "./variable-fields";

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
      <DialogContent className="sm:max-w-2xl">
        <VariableDialogHeader variable={variable} />
        <form
          noValidate
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          {/* Name and value side by side, the way a .env line reads. */}
          <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <KeyField form={form} locked={variable != null} />
            <ValueField form={form} savedSecret={variable?.kind === "secret"} />
          </div>
          <VariableOptions form={form} />
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
        {variable == null
          ? "Entra no ambiente do contêiner. O nome fica em maiúsculas sozinho."
          : "Mudanças entram no ambiente do contêiner no próximo deploy."}
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
      <p className="mr-auto hidden self-center text-xs text-muted-foreground sm:block">
        Vale a partir do próximo deploy.
      </p>
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
