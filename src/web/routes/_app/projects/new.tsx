import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, InfoIcon } from "lucide-react";
import { toast } from "sonner";

import { EMPTY_PROJECT_FORM, ProjectForm } from "@/web/components/forms/project-form";
import { toUserMessage } from "@/web/components/layout/error-message";
import { PageHeader } from "@/web/components/shell/page-header";
import { useCan } from "@/web/components/shell/use-permissions";
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
        eyebrow={<BackToProjectsLink />}
        title="Novo projeto"
        description="Cole a URL do repositório: o nome e o identificador são preenchidos sozinhos."
      />
      <div className="max-w-5xl space-y-4">
        {isAdmin ? null : <ApprovalNotice />}
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
              toast.error(toUserMessage(error, "Não foi possível criar o projeto."));
            }
          }}
        />
      </div>
    </>
  );
}

function BackToProjectsLink() {
  return (
    <Link
      to="/projects"
      className="inline-flex items-center gap-1 transition-colors hover:text-foreground focus-visible:underline focus-visible:outline-none"
    >
      <ChevronLeftIcon aria-hidden className="size-4" />
      Projetos
    </Link>
  );
}

function ApprovalNotice() {
  return (
    <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
      <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />O build executa o
      Dockerfile do repositório. Por segurança, projetos criados por quem não é administrador
      precisam ser aprovados por um administrador antes do primeiro deploy.
    </p>
  );
}
