import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, InfoIcon } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/web/components/page-header";
import { EMPTY_PROJECT_FORM, ProjectForm } from "@/web/components/project-form";
import { Card, CardContent } from "@/web/components/ui/card";
import { useCan } from "@/web/components/use-permissions";
import { createProjectFn } from "@/web/functions/projects.functions";

export const Route = createFileRoute("/_app/projects/new")({
  head: () => ({ meta: [{ title: "Novo projeto · Nelcota Deploy" }] }),
  component: NewProjectPage,
});

function NewProjectPage() {
  const navigate = useNavigate();
  const can = useCan();
  const isAdmin = can("project:approve");

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            to="/projects"
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground focus-visible:underline focus-visible:outline-none"
          >
            <ChevronLeftIcon aria-hidden className="size-4" />
            Projetos
          </Link>
        }
        title="Novo projeto"
        description="Informe o repositório; o Dockerfile e a porta já vêm com valores padrão."
      />
      <div className="max-w-3xl space-y-4">
        {isAdmin ? null : (
          <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />O build executa
            o Dockerfile do repositório. Por segurança, projetos criados por quem não é
            administrador precisam ser aprovados por um administrador antes do primeiro deploy.
          </p>
        )}
        <Card className="py-6">
          <CardContent className="px-6">
            <ProjectForm
              initialValues={EMPTY_PROJECT_FORM}
              submitLabel="Criar projeto"
              disabled={can("project:write") === false}
              onSubmit={async (values) => {
                try {
                  const project = await createProjectFn({ data: values });
                  toast.success("Projeto criado");
                  await navigate({
                    to: "/projects/$projectId",
                    params: { projectId: project.id },
                  });
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Não foi possível criar o projeto.",
                  );
                }
              }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
