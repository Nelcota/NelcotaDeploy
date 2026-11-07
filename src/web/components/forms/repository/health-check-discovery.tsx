import { toUserMessage } from "@/web/components/layout/error-message";
import { Button } from "@/web/components/ui/button";

import type { ProjectAutomation } from "./use-project-automation";

export function HealthCheckDiscovery({ automation }: { readonly automation: ProjectAutomation }) {
  const query = automation.healthCheck;
  if (query.isFetching) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Detectando health check no Dockerfile…
      </p>
    );
  }
  if (query.isError) {
    return (
      <div role="status" className="space-y-1 text-xs text-warning">
        {toUserMessage(
          query.error,
          "Não foi possível ler o health check. Você pode preencher o caminho.",
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          Detectar verificação de saúde novamente
        </Button>
      </div>
    );
  }
  if (query.data == null) {
    return null;
  }
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        {query.data.path == null
          ? "Nenhum caminho HTTP local detectado com segurança."
          : `Caminho detectado: ${query.data.path}.`}
      </p>
      {automation.manualFields.has("healthCheckPath") ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={automation.isDetecting}
          onClick={automation.useDetectedHealthCheck}
        >
          {query.data.path == null ? "Usar verificação de porta" : "Usar caminho detectado"}
        </Button>
      ) : null}
    </div>
  );
}
