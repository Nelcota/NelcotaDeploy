import { useQuery } from "@tanstack/react-query";
import { FileSearchIcon } from "lucide-react";
import { useState } from "react";

import type { EnvironmentVariableView } from "@/environments";
import { toUserMessage } from "@/web/components/layout/error-message";
import { CardTitleRow } from "@/web/components/layout/layout";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { getEnvironmentExampleFn } from "@/web/functions/repository/environment-example.functions";

import { TemplateImportDialog } from "./template-import-dialog";

const TEMPLATE_STALE_TIME_IN_MS = 300_000;

/** Automatically discovers the repository template and offers only the missing variables. */
export function RepositoryEnvironment({
  projectId,
  variables,
}: {
  readonly projectId: string;
  readonly variables: readonly EnvironmentVariableView[];
}) {
  const [path, setPath] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const project = useQuery(projectQueryOptions(projectId));
  const template = useQuery({
    queryKey: [
      "environment-example",
      projectId,
      project.data?.project.repositoryUrl,
      project.data?.project.branch,
      project.data?.project.buildContext,
      project.data?.project.dockerfilePath,
      path,
    ],
    queryFn: () => getEnvironmentExampleFn({ data: { projectId, path } }),
    enabled: project.data != null,
    staleTime: TEMPLATE_STALE_TIME_IN_MS,
    retry: false,
  });
  const data = template.data;
  const existing = new Set(variables.map((variable) => variable.key));
  const missing = data?.entries.filter((entry) => existing.has(entry.key) === false) ?? [];
  const domain = project.data?.domains.at(0);
  const applicationUrl =
    domain == null ? null : `${domain.httpsEnabled ? "https" : "http"}://${domain.hostname}`;
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={FileSearchIcon} title="Variáveis do repositório" />
      {template.isFetching ? (
        <p role="status" className="text-sm text-muted-foreground">
          Procurando .env.example na branch do projeto…
        </p>
      ) : null}
      {template.isError ? (
        <div role="status" className="space-y-2">
          <p className="text-sm text-warning">
            {toUserMessage(template.error, "Não foi possível ler o arquivo de exemplo.")}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void template.refetch()}>
            Detectar variáveis do repositório novamente
          </Button>
        </div>
      ) : null}
      {data == null ? null : (
        <>
          {data.paths.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum .env.example encontrado nesta branch.
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="environment-example-path">Arquivo de exemplo</Label>
              <Select value={data.source?.path ?? path ?? ""} onValueChange={setPath}>
                <SelectTrigger id="environment-example-path" className="w-full">
                  <SelectValue placeholder="Escolher arquivo encontrado" />
                </SelectTrigger>
                <SelectContent>
                  {data.paths.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {candidate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {data.source == null ? null : (
            <p className="text-sm text-muted-foreground">
              {data.entries.length} variáveis detectadas; {data.entries.length - missing.length} já
              configuradas e {missing.length} pendentes.
            </p>
          )}
          {data.pathsLimited ? (
            <p className="text-sm text-warning">
              A descoberta é parcial devido ao tamanho do repositório.
            </p>
          ) : null}
          {data.problems.length === 0 ? null : (
            <p className="text-sm text-warning">
              {data.problems.length} linha(s) inválida(s) ou com nomes reservados serão ignoradas.
              Somente variáveis válidas serão importadas.
            </p>
          )}
          {data.source == null || missing.length === 0 ? null : (
            <Button
              type="button"
              className="w-fit"
              disabled={template.isFetching || template.isError}
              onClick={() => setOpen(true)}
            >
              Configurar {missing.length} variáveis detectadas
            </Button>
          )}
        </>
      )}
      {open && data?.source != null ? (
        <TemplateImportDialog
          key={data.source.sha}
          projectId={projectId}
          entries={data.entries}
          variables={variables}
          applicationUrl={applicationUrl}
          source={`${data.source.path} · ${data.branch}`}
          ignoredLines={data.problems.length}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Card>
  );
}
