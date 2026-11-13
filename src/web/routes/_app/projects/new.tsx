import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, InfoIcon } from "lucide-react";
import { toast } from "sonner";

import { EMPTY_PROJECT_FORM, ProjectForm } from "@/web/components/forms/project-form";
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
      <PageHeader eyebrow={<BackToProjectsLink />} title="Novo projeto" />
      <div className="max-w-3xl space-y-4">
        {isAdmin ? null : <ApprovalNotice />}
        <ProjectForm
          initialValues={EMPTY_PROJECT_FORM}
          submitLabel="Criar projeto"
          disabled={can("project:write") === false}
          onSubmit={async (values) => {
            const result = await createProjectFn({ data: values });
            if (result.failure != null) {
              return result.failure;
            }

            toast.success("Projeto criado");
            await navigate({
              to: "/projects/$projectId",
              params: { projectId: result.project.id },
              replace: true,
            });
            return undefined;
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
      <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      Depois de criar o projeto, um administrador precisa aprová-lo antes do primeiro deploy.
    </p>
  );
}
