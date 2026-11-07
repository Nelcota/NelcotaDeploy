import { BoxIcon } from "lucide-react";
import type { ReactNode } from "react";

import { CardTitleRow } from "@/web/components/layout/layout";
import { currentContainer } from "@/web/components/projects/project-header";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { Card } from "@/web/components/ui/card";

/** Name and image of the running container, plus how many old ones remain. */
export function ContainerCard({ details }: { readonly details: ProjectDetails }) {
  const container = currentContainer(details);
  const others = details.containers.length - (container == null ? 0 : 1);
  return (
    <Card className="h-full gap-3 p-5">
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

/** A label and its value on one line; long values wrap instead of being cut. */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="space-y-0.5 py-2.5">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="text-sm break-all">{children}</dd>
    </div>
  );
}
