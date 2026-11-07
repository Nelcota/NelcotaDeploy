import { CopyButton } from "@/web/components/layout/copy-button";

/** Readable execution output, with explicit copying and preserved technical failure details. */
export function TaskExecutionOutput({
  output,
  errorMessage,
}: {
  readonly output: string;
  readonly errorMessage: string | null;
}) {
  return (
    <>
      {errorMessage == null || errorMessage.trim() === "" ? null : (
        <div className="space-y-2">
          <p className="text-sm text-destructive">
            A execução encontrou um erro. Consulte os detalhes técnicos para investigar.
          </p>
          <details className="rounded-lg bg-secondary p-3">
            <summary className="w-fit cursor-pointer rounded text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
              Detalhes do erro
            </summary>
            <pre
              tabIndex={0}
              aria-label="Detalhes técnicos do erro"
              className="mt-2 max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap break-all focus-visible:outline-2 focus-visible:outline-ring"
            >
              {errorMessage}
            </pre>
          </details>
        </div>
      )}
      {output.trim() === "" ? null : (
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Saída da execução</p>
            <CopyButton text={output} label="Copiar saída" />
          </div>
          <pre
            tabIndex={0}
            aria-label="Saída da execução"
            className="max-h-64 overflow-auto rounded-lg bg-console p-3 font-mono text-xs whitespace-pre-wrap break-all text-console-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {output}
          </pre>
        </div>
      )}
    </>
  );
}
