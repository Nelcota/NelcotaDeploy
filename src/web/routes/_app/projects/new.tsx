import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, InfoIcon } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/web/components/page-header";
import { EMPTY_PROJECT_FORM, ProjectForm } from "@/web/components/project-form";
import { Button } from "@/web/components/ui/button";
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
        title="Novo projeto"
        description="Informe o repositório; o Dockerfile e a porta já vêm com valores padrão."
        actions={
          <Button variant="ghost" asChild>
            <Link to="/projects">
              <ArrowLeftIcon aria-hidden />
              Voltar
            </Link>
          </Button>
        }
      />
      {isAdmin ? null : (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-[0.92rem]">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />O build executa o
          Dockerfile do repositório. Por segurança, projetos criados por quem não é administrador
          precisam ser aprovados por um administrador antes do primeiro deploy.
        </p>
      )}
      <Card>
        <CardContent>
          <ProjectForm
            initialValues={EMPTY_PROJECT_FORM}
            submitLabel="Criar projeto"
            disabled={can("project:write") === false}
            onSubmit={async (values) => {
              try {
                const project = await createProjectFn({ data: values });
                toast.success("Projeto criado");
                await navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Não foi possível criar o projeto.",
                );
              }
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
