import { MAX_DATABASES_PER_PROJECT } from "@/shared/schemas/database.schema";
import { toUserMessage } from "@/web/components/layout/error-message";
import { Button } from "@/web/components/ui/button";

import type { DatabaseCreation } from "./use-database-creation";

function DetectionStatus({ defaults }: { readonly defaults: DatabaseCreation["defaults"] }) {
  if (defaults.template.isFetching) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Procurando variáveis de conexão no repositório…
      </p>
    );
  }
  if (defaults.template.isError) {
    return (
      <p role="status" className="text-xs text-warning">
        Não foi possível ler o .env.example. O nome sugerido considera as variáveis já configuradas.{" "}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void defaults.template.refetch()}
        >
          Buscar variáveis de conexão no repositório
        </Button>
      </p>
    );
  }
  return null;
}

export function DatabaseCreationNotes({ creation }: { readonly creation: DatabaseCreation }) {
  const { defaults, suggestion, customKey, resetKey, configurationError, limited } = creation;
  return (
    <>
      {customKey == null ? (
        <p className="text-xs text-muted-foreground">
          {suggestion.fromTemplate
            ? "Variável detectada no .env.example. A conexão será preenchida automaticamente."
            : "Nome disponível sugerido automaticamente. Variáveis existentes serão preservadas."}
        </p>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={resetKey}>
          Usar sugestão automática
        </Button>
      )}
      {suggestion.candidates.length > 1 ? (
        <p className="text-xs text-warning">
          O arquivo espera mais de uma conexão. Escolha a variável correspondente na lista do campo
          ou mantenha o novo nome sugerido.
        </p>
      ) : null}
      <DetectionStatus defaults={defaults} />
      {configurationError == null ? null : (
        <div role="alert" className="text-sm text-destructive">
          {toUserMessage(
            configurationError,
            "Não foi possível carregar a configuração do projeto.",
          )}{" "}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void defaults.variables.refetch();
              void defaults.servers.refetch();
              void defaults.project.refetch();
            }}
          >
            Atualizar configuração do projeto
          </Button>
        </div>
      )}
      {limited ? (
        <p className="text-sm text-warning">
          O projeto já atingiu o limite de {MAX_DATABASES_PER_PROJECT} bancos.
        </p>
      ) : null}
    </>
  );
}
