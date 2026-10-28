import { useQueryClient } from "@tanstack/react-query";
import { FileUpIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { parseDotenv } from "@/shared/dotenv";
import { saveEnvironmentVariableFn } from "@/web/functions/environment.functions";

import { type VariableKind, VariableKindToggle } from "./env-kind-toggle";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

const MAX_PROBLEMS_SHOWN = 5;

/** Pastes a `.env` file and saves every valid line as a variable of the chosen kind. */
export function EnvImportDialog({ projectId }: { readonly projectId: string }) {
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
      } catch {
        failed.push(entry.key);
      }
    }
    setSaving(false);
    await queryClient.invalidateQueries({ queryKey: ["environment", projectId] });
    if (failed.length > 0) {
      toast.error(`${saved} importadas; falharam: ${failed.join(", ")}`);
      return;
    }
    toast.success(saved === 1 ? "1 variável importada" : `${saved} variáveis importadas`);
    setText("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <Label htmlFor="env-import-kind">Importar como</Label>
          <VariableKindToggle id="env-import-kind" value={kind} onChange={setKind} />
        </div>
        <div
          id="env-import-summary"
          aria-live="polite"
          className="space-y-1 rounded-lg bg-secondary px-3 py-2.5 text-sm ring-1 ring-border ring-inset"
        >
          <p>
            {parsed.entries.length === 1
              ? "1 variável pronta"
              : `${parsed.entries.length} variáveis prontas`}
            {parsed.problems.length > 0 ? ` · ${parsed.problems.length} linha(s) ignorada(s)` : ""}
          </p>
          {parsed.problems.slice(0, MAX_PROBLEMS_SHOWN).map((problem) => (
            <p key={problem.line} className="text-xs text-destructive">
              Linha {problem.line}: {problem.reason}
            </p>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={saving || parsed.entries.length === 0}
            onClick={() => void importAll()}
          >
            Importar {parsed.entries.length > 0 ? parsed.entries.length : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
