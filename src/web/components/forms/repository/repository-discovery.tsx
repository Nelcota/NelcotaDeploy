import { toUserMessage } from "@/web/components/layout/error-message";
import { Button } from "@/web/components/ui/button";

import type { ProjectAutomation } from "./use-project-automation";

/** Explains discovery failures and ambiguous choices instead of silently falling back to typing. */
export function RepositoryDiscovery({
  automation,
  creating = false,
}: {
  readonly automation: ProjectAutomation;
  readonly creating?: boolean;
}) {
  const query = automation.inspection;
  if (query.isFetching) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Detectando branches, Dockerfiles e diretórios…
      </p>
    );
  }
  if (query.isError) {
    return (
      <div role="status" className="space-y-2 text-sm text-warning">
        <p>
          {toUserMessage(
            query.error,
            "Não foi possível detectar a configuração. Você pode preencher os campos.",
          )}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          Detectar configurações do repositório novamente
        </Button>
      </div>
    );
  }
  const data = query.data;
  if (data == null) {
    return null;
  }
  return (
    <div role="status" className="space-y-1 text-sm text-muted-foreground">
      <p>
        Branch padrão: <span className="font-mono text-foreground">{data.defaultBranch}</span>.{" "}
        {data.dockerfiles.length} Dockerfile(s) encontrado(s).
      </p>
      {data.dockerfiles.length === 0 ? (
        <p className="text-warning">
          {creating
            ? "Nenhum Dockerfile encontrado. Escolha Railpack para build automático ou informe o caminho em Ajustes avançados."
            : "Nenhum Dockerfile encontrado. Adicione um ao repositório ou informe o caminho em Build."}
        </p>
      ) : null}
      {data.dockerfiles.length > 1 ? (
        <p>
          Confira o Dockerfile em {creating ? "Ajustes avançados" : "Build"}. As opções encontradas
          estão disponíveis no campo.
        </p>
      ) : null}
      {data.pathsLimited || data.branchesLimited ? (
        <p>
          A lista é parcial devido ao tamanho do repositório. Você também pode informar um caminho
          ou branch.
        </p>
      ) : null}
      <p>Os campos que você personalizar serão preservados.</p>
    </div>
  );
}
