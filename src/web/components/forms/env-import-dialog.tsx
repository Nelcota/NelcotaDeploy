import { useQueryClient } from "@tanstack/react-query";
import { FileUpIcon, LoaderCircleIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { parseDotenv } from "@/shared/dotenv";
import { pluralize } from "@/shared/format";
import { type VariableKind, VariableKindToggle } from "@/web/components/forms/env-kind-toggle";
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
import { Textarea } from "@/web/components/ui/textarea";
import { saveEnvironmentVariableFn } from "@/web/functions/environment.functions";

const MAX_PROBLEMS_SHOWN = 5;

/** Pastes a `.env` file and saves every valid line as a variable of the chosen kind. */
export function EnvImportDialog({
  projectId,
  onImported,
}: {
  readonly projectId: string;
  /** Called after at least one variable was saved. */
  readonly onImported: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<VariableKind>("plain");
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => parseDotenv(text), [text]);

  const importAll = async () => {
    setSaving(true);
    let saved = 0;
    const failed: string[] = [];
    const failedLines: string[] = [];
    for (const entry of parsed.entries) {
      try {
        // Sequential on purpose: each save is an audited write and the list is small.
        await saveEnvironmentVariableFn({
          data: {
            projectId,
            variable: { key: entry.key, kind, value: entry.value, availableAtBuild: false },
          },
        });
        saved += 1;
      } catch (error) {
        console.error("failed to import variable", entry.key, error);
        failed.push(entry.key);
        failedLines.push(`${entry.key}=${entry.value}`);
      }
    }
    setSaving(false);
    await queryClient.invalidateQueries({ queryKey: ["environment", projectId] });
    if (saved > 0) {
      onImported();
    }
    if (failed.length > 0) {
      // Only the lines that failed stay in the field, so importing again does not repeat the rest.
      setText(failedLines.join("\n"));
      toast.error(
        `${saved} importadas. Não foi possível salvar: ${failed.join(", ")}. As linhas com erro ficaram no campo.`,
      );
      return;
    }
    toast.success(saved === 1 ? "1 variável importada" : `${saved} variáveis importadas`);
    setText("");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving === false) {
          setOpen(next);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileUpIcon aria-hidden />
          Importar .env
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar variáveis</DialogTitle>
          <DialogDescription>
            Cole o conteúdo de um arquivo .env. Nomes já existentes são substituídos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="env-import-text">Conteúdo</Label>
          <Textarea
            id="env-import-text"
            aria-describedby="env-import-summary"
            className="min-h-48 bg-surface-sunken font-mono text-sm"
            spellCheck={false}
            autoComplete="off"
            placeholder={"NODE_ENV=production\nDATABASE_URL=postgres://..."}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label id="env-import-kind-label" htmlFor="env-import-kind">
            Importar como
          </Label>
          <VariableKindToggle id="env-import-kind" value={kind} onChange={setKind} />
        </div>
        <div
          id="env-import-summary"
          aria-live="polite"
          className="space-y-1 rounded-lg bg-card px-3 py-2.5 text-sm ring-1 ring-border ring-inset"
        >
          <p>
            {parsed.entries.length === 1
              ? "1 variável pronta"
              : `${parsed.entries.length} variáveis prontas`}
            {parsed.problems.length > 0
              ? ` · ${pluralize(parsed.problems.length, "linha ignorada", "linhas ignoradas")}`
              : ""}
          </p>
          {parsed.problems.slice(0, MAX_PROBLEMS_SHOWN).map((problem) => (
            <p key={problem.line} className="text-xs text-destructive">
              Linha {problem.line}: {problem.reason}
            </p>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={saving || parsed.entries.length === 0}
            onClick={() => void importAll()}
          >
            {saving ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            {saving
              ? "Importando…"
              : `Importar ${parsed.entries.length > 0 ? parsed.entries.length : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
