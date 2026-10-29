import { FileUpIcon, LoaderCircleIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { parseDotenv } from "@/shared/dotenv";
import { EnvImportSummary } from "@/web/components/forms/env-import-summary";
import { type VariableKind, VariableKindToggle } from "@/web/components/forms/env-kind-toggle";
import { useEnvImport } from "@/web/components/forms/use-env-import";
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

function importButtonLabel(saving: boolean, readyCount: number): string {
  if (saving) {
    return "Importando…";
  }
  return `Importar ${readyCount > 0 ? readyCount : ""}`;
}

function ImportForm({
  text,
  kind,
  onTextChange,
  onKindChange,
}: {
  readonly text: string;
  readonly kind: VariableKind;
  readonly onTextChange: (text: string) => void;
  readonly onKindChange: (kind: VariableKind) => void;
}) {
  return (
    <>
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
          onChange={(event) => onTextChange(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label id="env-import-kind-label" htmlFor="env-import-kind">
          Importar como
        </Label>
        <VariableKindToggle id="env-import-kind" value={kind} onChange={onKindChange} />
      </div>
    </>
  );
}

function ImportFooter({
  saving,
  readyCount,
  onCancel,
  onImport,
}: {
  readonly saving: boolean;
  readonly readyCount: number;
  readonly onCancel: () => void;
  readonly onImport: () => void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
        Cancelar
      </Button>
      <Button type="button" disabled={saving || readyCount === 0} onClick={onImport}>
        {saving ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
        {importButtonLabel(saving, readyCount)}
      </Button>
    </DialogFooter>
  );
}

function ImportTrigger() {
  return (
    <DialogTrigger asChild>
      <Button variant="outline">
        <FileUpIcon aria-hidden />
        Importar .env
      </Button>
    </DialogTrigger>
  );
}

type EnvImportDialogProps = {
  readonly projectId: string;
  /** Called after at least one variable was saved. */
  readonly onImported: () => void;
};

/** Pastes a `.env` file and saves every valid line as a variable of the chosen kind. */
export function EnvImportDialog({ projectId, onImported }: EnvImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<VariableKind>("plain");
  const parsed = useMemo(() => parseDotenv(text), [text]);
  const { saving, importEntries } = useEnvImport(projectId);

  const changeOpen = (next: boolean) => {
    if (saving) {
      return;
    }
    setOpen(next);
  };

  const importAll = async () => {
    const result = await importEntries(parsed.entries, kind);
    if (result.savedCount > 0) {
      onImported();
    }
    setText(result.remainingText);
    if (result.failedKeys.length === 0) {
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <ImportTrigger />
      <DialogContent className="sm:max-w-2xl">
        <ImportForm text={text} kind={kind} onTextChange={setText} onKindChange={setKind} />
        <EnvImportSummary
          id="env-import-summary"
          entries={parsed.entries}
          problems={parsed.problems}
        />
        <ImportFooter
          saving={saving}
          readyCount={parsed.entries.length}
          onCancel={() => setOpen(false)}
          onImport={() => void importAll()}
        />
      </DialogContent>
    </Dialog>
  );
}
