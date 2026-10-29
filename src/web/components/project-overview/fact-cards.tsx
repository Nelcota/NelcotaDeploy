import { Link } from "@tanstack/react-router";
import { BoxIcon, ExternalLinkIcon, SlidersHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { CardTitleRow, TEXT_LINK } from "@/web/components/layout/layout";
import { currentContainer } from "@/web/components/projects/project-header";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { Card } from "@/web/components/ui/card";

/** Name and image of the running container, plus how many old ones remain. */
export function ContainerCard({ details }: { readonly details: ProjectDetails }) {
  const container = currentContainer(details);
  const others = details.containers.length - (container == null ? 0 : 1);
  return (
    <Card className="gap-3 p-5">
      <CardTitleRow icon={BoxIcon} title="Contêiner" />
      {container == null ? (
        <p className="py-2.5 text-sm text-muted-foreground">Nenhum contêiner em execução.</p>
      ) : (
        <dl className="divide-y divide-border">
          <Fact label="Nome">
            <span className="font-mono">{container.name}</span>
          </Fact>
          <Fact label="Imagem">
            <span className="font-mono">{container.image}</span>
          </Fact>
          {others > 0 ? (
            <Fact label="Outros">
              {others === 1 ? "1 contêiner antigo" : `${others} contêineres antigos`}
            </Fact>
          ) : null}
        </dl>
      )}
    </Card>
  );
}

/** Repository, build and deploy settings of the project. */
export function ConfigurationCard({ details }: { readonly details: ProjectDetails }) {
  const { project } = details;
  return (
    <Card className="gap-3 p-5">
      <CardTitleRow icon={SlidersHorizontalIcon} title="Configuração">
        <Link
          to="/projects/$projectId/settings"
          params={{ projectId: project.id }}
          className={TEXT_LINK}
        >
          Editar
        </Link>
      </CardTitleRow>
      <dl className="divide-y divide-border">
        <Fact label="Repositório">
          <a
            href={`https://github.com/${project.repositoryFullName}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-w-0 items-center gap-1 rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="truncate">{project.repositoryFullName}</span>
            <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
        </Fact>
        <Fact label="Branch">
          <span className="font-mono">{project.branch}</span>
        </Fact>
        <Fact label="Dockerfile">
          <span className="font-mono">{project.dockerfilePath}</span>
        </Fact>
        <Fact label="Porta interna">{project.internalPort}</Fact>
        <Fact label="Verificação de saúde">
          {project.healthCheckPath == null ? "Conexão TCP" : `HTTP ${project.healthCheckPath}`}
        </Fact>
        <Fact label="Deploy">{project.autoDeploy ? "Automático a cada push" : "Manual"}</Fact>
      </dl>
    </Card>
  );
}

/** A label and its value on one line; long values wrap instead of being cut. */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="space-y-0.5 py-2.5">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="text-sm break-all">{children}</dd>
    </div>
  );
}
