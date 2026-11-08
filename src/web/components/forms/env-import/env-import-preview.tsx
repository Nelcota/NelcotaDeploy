import type { EnvironmentVariableView } from "@/environments";
import {
  suggestedVariableKind,
  type EnvironmentImportInput,
} from "@/shared/schemas/environment/environment-import.schema";

/** Reviews replacements and encryption without echoing credentials into the preview. */
export function EnvImportPreview({
  input,
  variables,
}: {
  readonly input: EnvironmentImportInput;
  readonly variables: readonly EnvironmentVariableView[];
}) {
  const existing = new Map(variables.map((variable) => [variable.key, variable]));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Confira as alterações. Ao confirmar, o painel salvará o conjunto completo e atualizará a
        aplicação recriando o contêiner se a opção de aplicar alterações automaticamente estiver
        ativada.
      </p>
      <ul
        aria-label="Revisão das variáveis a importar"
        className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg ring-1 ring-border"
      >
        {input.entries.map((entry) => {
          const previous = existing.get(entry.key);
          const kind =
            input.kind === "automatic"
              ? (previous?.kind ?? entry.kind ?? suggestedVariableKind(entry.key, entry.value))
              : input.kind;
          const keepSecret = previous != null && kind === "secret" && entry.value === "";
          let change = entry.expectedUpdatedAt == null ? "Adicionar" : "Substituir valor";
          if (keepSecret) {
            change = "Manter valor atual";
          }
          return (
            <li
              key={entry.key}
              className="grid gap-1 px-3 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_9rem_10rem] sm:gap-3"
            >
              <span className="font-mono break-all">{entry.key}</span>
              <span className="text-muted-foreground">{change}</span>
              <span>{kind === "secret" ? "Secret criptografado" : "Configuração visível"}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-faint">
        As opções de build e previews das variáveis existentes serão preservadas. Novos secrets não
        serão enviados para previews.
      </p>
    </div>
  );
}
