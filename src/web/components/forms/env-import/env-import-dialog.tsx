import { FileUpIcon, LoaderCircleIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { EnvironmentVariableView } from "@/environments";
import { parseDotenv } from "@/shared/dotenv";
import {
  environmentImportSchema,
  MAX_IMPORT_TEXT_LENGTH,
  type EnvironmentImportInput,
} from "@/shared/schemas/environment/environment-import.schema";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/web/components/ui/dialog";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";
import { Textarea } from "@/web/components/ui/textarea";

import { VariableKindToggle } from "../env-kind-toggle";
import { EnvImportFile } from "./env-import-file";
import { EnvImportPreview } from "./env-import-preview";
import { EnvImportSummary } from "./env-import-summary";
import { useEnvImport } from "./use-env-import";

function ImportKind({
  value,
  onChange,
}: {
  readonly value: EnvironmentImportInput["kind"];
  readonly onChange: (kind: EnvironmentImportInput["kind"]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Switch
          id="env-import-automatic"
          checked={value === "automatic"}
          onCheckedChange={(checked) => onChange(checked ? "automatic" : "secret")}
        />
        <Label htmlFor="env-import-automatic">Detectar secrets automaticamente</Label>
      </div>
      {value === "automatic" ? null : (
        <div className="space-y-2">
          <Label id="env-import-kind-label" htmlFor="env-import-kind">
            Importar todas como
          </Label>
          <VariableKindToggle id="env-import-kind" value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

/** Reviews additions and replacements before importing the entire batch atomically. */
export function EnvImportDialog({
  projectId,
  variables,
  onImported,
}: {
  readonly projectId: string;
  readonly variables: readonly EnvironmentVariableView[] | undefined;
  readonly onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<EnvironmentImportInput["kind"]>("automatic");
  const [reviewed, setReviewed] = useState<EnvironmentImportInput | null>(null);
  const [reviewVariables, setReviewVariables] = useState<readonly EnvironmentVariableView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const parsed = useMemo(() => parseDotenv(text), [text]);
  const { saving, importEntries } = useEnvImport(projectId);
  const changeOpen = (next: boolean) => {
    if (saving || readingFile) {
      return;
    }
    setOpen(next);
    setReviewed(null);
    setError(null);
    if (next === false) {
      setText("");
      setKind("automatic");
      setReviewVariables([]);
    }
  };

  const review = () => {
    const current = new Map(
      (variables ?? []).map((variable) => [variable.key, variable.updatedAt]),
    );
    const result = environmentImportSchema.safeParse({
      kind,
      entries: parsed.entries.map((entry) => ({
        ...entry,
        expectedUpdatedAt: current.get(entry.key) ?? null,
      })),
    });
    if (result.success === false) {
      setError(result.error.issues.at(0)?.message ?? "Confira as variáveis.");
      return;
    }
    setError(null);
    setReviewVariables(variables ?? []);
    setReviewed(result.data);
  };
  const confirm = async () => {
    if (reviewed == null || saving) {
      return;
    }
    const imported = await importEntries(reviewed);
    if (imported === false) {
      setReviewed(null);
      return;
    }
    onImported();
    setText("");
    setReviewed(null);
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={variables == null}>
          <FileUpIcon aria-hidden />
          Selecionar ou colar arquivo .env
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader icon={<FileUpIcon />}>
          <DialogTitle>
            {reviewed == null ? "Importar variáveis" : "Confirmar importação"}
          </DialogTitle>
          <DialogDescription>
            {reviewed == null
              ? "Selecione um arquivo ou cole um .env. Você revisará inclusões e substituições antes de salvar."
              : "Confira as variáveis antes de aplicar as mudanças."}
          </DialogDescription>
        </DialogHeader>
        {reviewed == null ? (
          <>
            <EnvImportFile
              onLoadingChange={setReadingFile}
              onLoaded={(content) => {
                setText(content);
                setError(null);
              }}
            />
            <div className="space-y-2">
              <Label htmlFor="env-import-text">Conteúdo</Label>
              <Textarea
                id="env-import-text"
                disabled={readingFile}
                aria-describedby="env-import-summary"
                className="min-h-48 font-mono text-sm"
                spellCheck={false}
                autoComplete="off"
                maxLength={MAX_IMPORT_TEXT_LENGTH}
                placeholder={"NODE_ENV=production\nDATABASE_URL=postgres://..."}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <ImportKind value={kind} onChange={setKind} />
            <EnvImportSummary
              id="env-import-summary"
              entries={parsed.entries}
              problems={parsed.problems}
            />
          </>
        ) : (
          <EnvImportPreview input={reviewed} variables={reviewVariables} />
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
            disabled={saving || readingFile}
            onClick={() => (reviewed == null ? changeOpen(false) : setReviewed(null))}
          >
            {reviewed == null ? "Cancelar importação" : "Voltar para editar importação"}
          </Button>
          {reviewed == null ? (
            <Button
              type="button"
              disabled={
                readingFile ||
                parsed.entries.length === 0 ||
                parsed.problems.length > 0 ||
                variables == null
              }
              onClick={review}
            >
              Revisar alterações das variáveis
            </Button>
          ) : (
            <Button type="button" disabled={saving} onClick={() => void confirm()}>
              {saving ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}Importar
              {reviewed.entries.length} variável(is) revisada(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
