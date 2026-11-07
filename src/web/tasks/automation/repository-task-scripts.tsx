import { toUserMessage } from "@/web/components/layout/error-message";
import { Button } from "@/web/components/ui/button";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

import type { TaskAutomation } from "./use-task-automation";

export function RepositoryTaskScripts({ automation }: { readonly automation: TaskAutomation }) {
  const { discovery, candidates, script, tasks } = automation;
  return (
    <div className="space-y-3 rounded-lg p-3 ring-1 ring-border">
      <p className="text-sm font-medium">Scripts do repositório</p>
      {discovery.isFetching ? (
        <p role="status" className="text-xs text-muted-foreground">
          Procurando scripts no package.json…
        </p>
      ) : null}
      {discovery.isError ? (
        <p role="alert" className="text-xs text-warning">
          {toUserMessage(discovery.error, "Não foi possível ler os scripts.")}{" "}
          <Button type="button" variant="link" size="sm" onClick={() => void discovery.refetch()}>
            Buscar scripts novamente
          </Button>
        </p>
      ) : null}
      {tasks.isError ? (
        <p role="alert" className="text-xs text-warning">
          Não foi possível verificar nomes já usados.{" "}
          <Button type="button" variant="link" size="sm" onClick={() => void tasks.refetch()}>
            Atualizar tarefas existentes
          </Button>
        </p>
      ) : null}
      {(discovery.data?.paths.length ?? 0) > 1 ? (
        <div className="space-y-1">
          <Label htmlFor="task-package-path">Arquivo de scripts</Label>
          <Select
            value={discovery.data?.source?.path ?? automation.packagePath ?? ""}
            onValueChange={automation.choosePackage}
          >
            <SelectTrigger id="task-package-path" className="w-full">
              <SelectValue placeholder="Escolher package.json" />
            </SelectTrigger>
            <SelectContent>
              {discovery.data?.paths.map((path) => (
                <SelectItem key={path} value={path}>
                  {path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {candidates.length === 0 ? null : (
        <div className="space-y-1">
          <Label htmlFor="task-repository-script">Script</Label>
          <Select value={script?.name ?? ""} onValueChange={automation.selectScript}>
            <SelectTrigger id="task-repository-script" className="w-full">
              <SelectValue placeholder="Escolher script detectado" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.name} value={candidate.name}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {discovery.data?.source == null ? null : (
        <p className="text-xs text-muted-foreground">
          {discovery.data.source.path} · {discovery.data.branch}. O script precisa existir no
          diretório de trabalho da imagem.
        </p>
      )}
      {discovery.data?.source != null &&
      candidates.length > 0 &&
      discovery.data.bunDetected === false ? (
        <p className="text-xs text-warning">
          Não foi possível confirmar o Bun na imagem final. Os comandos sugeridos usam Bun; confira
          sua disponibilidade no contêiner antes de executar.
        </p>
      ) : null}
      {discovery.data?.limited === true || discovery.data?.pathsLimited === true ? (
        <p className="text-xs text-warning">
          A descoberta é parcial; scripts com nomes não suportados não serão sugeridos.
        </p>
      ) : null}
      {discovery.data != null && discovery.isFetching === false && candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum script disponível neste arquivo. Você ainda pode informar um comando.
        </p>
      ) : null}
      {script != null && automation.manual.has("commandLine") ? (
        <Button type="button" variant="outline" size="sm" onClick={automation.useSelectedCommand}>
          Usar comando do script selecionado
        </Button>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Campos personalizados serão preservados. Detectar e salvar uma tarefa sob demanda não
        executa o comando.
      </p>
    </div>
  );
}
