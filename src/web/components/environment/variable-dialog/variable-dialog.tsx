import { useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";

import type { EnvironmentVariableView } from "@/environments";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

import { useVariableAutomation } from "./use-variable-automation";
import { useVariableForm } from "./use-variable-form";
import { KeyField, ValueField, VariableOptions } from "./variable-fields";

/** Creates a variable, or edits one when `variable` is given. */
export function VariableDialog({
  projectId,
  open,
  onOpenChange,
  variable,
  existingKeys,
  onSaved,
}: {
  readonly projectId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly variable: EnvironmentVariableView | null;
  readonly existingKeys: readonly string[];
  readonly onSaved: () => void;
}) {
  const { form, save } = useVariableForm({
    projectId,
    variable,
    existingKeys,
    onSaved: () => {
      onSaved();
      onOpenChange(false);
    },
  });
  const project = useQuery(projectQueryOptions(projectId));
  const domain = project.data?.domains.at(0);
  const automation = useVariableAutomation(form, {
    editing: variable != null,
    existingKeys,
    applicationUrl:
      domain == null ? null : `${domain.httpsEnabled ? "https" : "http"}://${domain.hostname}`,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (save.isPending === false) {
          onOpenChange(next);
        }
      }}
    >
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
          <fieldset disabled={save.isPending} className="space-y-6">
            <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <KeyField
                form={form}
                locked={variable != null}
                onPasteAssignment={automation.pasteAssignment}
              />
              <ValueField
                form={form}
                savedSecret={variable?.kind === "secret"}
                onValueEdited={() => automation.markEdited("value")}
              />
            </div>
            {variable == null ? (
              <p role="status" className="text-xs text-muted-foreground">
                Tipo e proteção de previews são detectados automaticamente. URLs da aplicação e
                segredos locais conhecidos são preenchidos quando possível. Suas edições são
                preservadas.
              </p>
            ) : null}
            <VariableOptions form={form} onEdited={automation.markEdited} />
          </fieldset>
          <VariableDialogFooter
            isPending={save.isPending}
            autoApply={project.data?.project.autoApplyChanges === true}
            onCancel={() => onOpenChange(false)}
          />
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
          : "O novo valor entra no ambiente do contêiner."}
      </DialogDescription>
    </DialogHeader>
  );
}

function VariableDialogFooter({
  isPending,
  onCancel,
  autoApply,
}: {
  readonly isPending: boolean;
  readonly onCancel: () => void;
  readonly autoApply: boolean;
}) {
  return (
    <DialogFooter>
      <p className="mr-auto self-center text-xs text-muted-foreground">
        {autoApply
          ? "Se houver uma versão publicada, salvar recria o contêiner com as novas variáveis."
          : "Vale a partir do próximo deploy."}
      </p>
      <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>
        Cancelar
      </Button>
      <Button type="submit" disabled={isPending}>
        {isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
        Salvar variável
      </Button>
    </DialogFooter>
  );
}
