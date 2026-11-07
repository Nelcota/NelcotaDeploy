import { useState } from "react";

import type { EnvironmentVariableView } from "@/environments";
import {
  environmentImportSchema,
  type EnvironmentImportInput,
} from "@/shared/schemas/environment-import.schema";
import { EnvImportPreview } from "@/web/components/forms/env-import/env-import-preview";
import { useEnvImport } from "@/web/components/forms/env-import/use-env-import";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";

import { createTemplateDraft, type TemplateEntry } from "./template-draft";
import { TemplateVariableRow } from "./template-variable-row";

/** Stages missing variables and waits for one explicit confirmation before saving the batch. */
export function TemplateImportDialog({
  projectId,
  entries,
  variables,
  applicationUrl,
  source,
  ignoredLines,
  onClose,
}: {
  readonly projectId: string;
  readonly entries: readonly TemplateEntry[];
  readonly variables: readonly EnvironmentVariableView[];
  readonly applicationUrl: string | null;
  readonly source: string;
  readonly ignoredLines: number;
  readonly onClose: () => void;
}) {
  const [drafts, setDrafts] = useState(() =>
    createTemplateDraft(entries, { variables, applicationUrl }),
  );
  const [reviewed, setReviewed] = useState<EnvironmentImportInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { saving, importEntries } = useEnvImport(projectId);
  const selected = drafts.filter((draft) => draft.selected);
  const missingCredentials = selected.some(
    (draft) => draft.kind === "secret" && draft.value.trim() === "",
  );
  const review = () => {
    const parsed = environmentImportSchema.safeParse({
      kind: "automatic",
      entries: selected.map(({ key, value, kind }) => ({
        key,
        value,
        kind,
        expectedUpdatedAt: null,
      })),
    });
    if (parsed.success === false) {
      setError(parsed.error.issues.at(0)?.message ?? "Confira os valores.");
      return;
    }
    setReviewed(parsed.data);
    setError(null);
  };
  const confirm = async () => {
    if (reviewed == null || saving) {
      return;
    }
    const success = await importEntries(reviewed);
    if (success) {
      onClose();
      return;
    }
    setReviewed(null);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open === false && saving === false) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {reviewed == null ? "Configurar variáveis detectadas" : "Confirmar variáveis"}
          </DialogTitle>
          <DialogDescription>
            Origem: {source}. Variáveis já configuradas serão preservadas.
          </DialogDescription>
        </DialogHeader>
        {ignoredLines > 0 ? (
          <p className="text-sm text-warning">
            {ignoredLines} linha(s) inválida(s) ou reservada(s) do arquivo serão ignoradas.
          </p>
        ) : null}
        {reviewed == null ? (
          <div className="max-h-96 space-y-3 overflow-y-auto p-1">
            {drafts.map((draft) => (
              <TemplateVariableRow
                key={draft.key}
                draft={draft}
                onChange={(next) =>
                  setDrafts((current) =>
                    current.map((item) => (item.key === next.key ? next : item)),
                  )
                }
              />
            ))}
            {missingCredentials ? (
              <p className="text-sm text-warning">
                Preencha as credenciais pendentes ou desmarque as variáveis que não serão usadas
                agora.
              </p>
            ) : null}
          </div>
        ) : (
          <EnvImportPreview input={reviewed} variables={variables} />
        )}
        {error == null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => (reviewed == null ? onClose() : setReviewed(null))}
          >
            {reviewed == null ? "Cancelar importação" : "Voltar para editar variáveis"}
          </Button>
          {reviewed == null ? (
            <Button
              type="button"
              disabled={selected.length === 0 || missingCredentials}
              onClick={review}
            >
              Revisar {selected.length} variáveis
            </Button>
          ) : (
            <Button type="button" disabled={saving} onClick={() => void confirm()}>
              {saving ? "Importando variáveis…" : "Importar variáveis revisadas"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
