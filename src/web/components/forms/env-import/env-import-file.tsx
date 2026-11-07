import { useRef, useState } from "react";

import { MAX_IMPORT_TEXT_LENGTH } from "@/shared/schemas/environment/environment-import.schema";
import { Button } from "@/web/components/ui/button";
import { Label } from "@/web/components/ui/label";

/** Reads a bounded UTF-8 file locally; nothing is uploaded until the import is confirmed. */
export async function readEnvImportFile(file: File): Promise<string> {
  if (file.size === 0 || file.size > MAX_IMPORT_TEXT_LENGTH) {
    throw new RangeError("Environment import file must contain between 1 and 262144 bytes");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  if (text.trim() === "" || text.includes("\0")) {
    throw new TypeError("Environment import file must contain UTF-8 text without null bytes");
  }
  return text;
}

export function EnvImportFile({
  onLoaded,
  onLoadingChange,
}: {
  readonly onLoaded: (text: string) => void;
  readonly onLoadingChange: (loading: boolean) => void;
}) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadFile = async (file: File) => {
    setReading(true);
    onLoadingChange(true);
    setError(null);
    try {
      onLoaded(await readEnvImportFile(file));
      setFileName(file.name);
    } catch {
      setError(
        "Não foi possível ler o arquivo. Use um .env em UTF-8, não vazio e com até 256 KiB.",
      );
    } finally {
      setReading(false);
      onLoadingChange(false);
    }
  };
  return (
    <div className="space-y-2">
      <Label htmlFor="env-import-file">Selecionar arquivo .env</Label>
      <input
        ref={fileInput}
        id="env-import-file"
        hidden
        type="file"
        aria-describedby="env-import-file-hint"
        aria-invalid={error != null}
        disabled={reading}
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.item(0);
          input.value = "";
          if (file != null) {
            void loadFile(file);
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={reading}
          onClick={() => fileInput.current?.click()}
        >
          Escolher arquivo .env
        </Button>
        {fileName == null ? null : (
          <p role="status" className="min-w-0 text-xs break-all text-muted-foreground">
            Arquivo lido: {fileName}
          </p>
        )}
      </div>
      <p id="env-import-file-hint" className="text-xs text-muted-foreground">
        Lido no navegador. Os valores só serão enviados após revisar e confirmar a importação.
      </p>
      {reading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Lendo arquivo…
        </p>
      ) : null}
      {error == null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
