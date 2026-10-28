import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  GitBranchIcon,
  HammerIcon,
  IdCardIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  type LucideIcon,
  SaveIcon,
  SettingsIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { toUserMessage } from "@/web/components/error-message";
import { Tag } from "@/web/components/layout";
import {
  AutoDeployField,
  BuildFields,
  HealthCheckField,
  IdentityFields,
  PortField,
  projectToFormValues,
  RepositoryFields,
  useProjectForm,
} from "@/web/components/project-form";
import { TabHeader } from "@/web/components/project-header";
import { projectQueryOptions } from "@/web/components/project-query";
import { ErrorState, ListSkeleton } from "@/web/components/states";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import {
  deleteProjectFn,
  setRepositoryTokenFn,
  updateProjectFn,
} from "@/web/functions/projects.functions";

const SETTINGS_FORM_ID = "project-settings-form";

export const Route = createFileRoute("/_app/projects/$projectId/settings")({
  head: () => ({ meta: [{ title: "Ajustes · Nelcota Deploy" }] }),
  component: ProjectSettingsPage,
});

function ProjectSettingsPage() {
  const { projectId } = Route.useParams();
  const details = useQuery(projectQueryOptions(projectId));
  const can = useCan();

  if (details.isError) {
    return <ErrorState error={details.error} onRetry={() => void details.refetch()} />;
  }
  if (details.data == null) {
    return <ListSkeleton rows={6} />;
  }
  const { project } = details.data;

  return (
    <div className="space-y-6">
      <TabHeader
        icon={SettingsIcon}
        title="Ajustes do projeto"
        description="Repositório, build e porta. Ao alterar um campo, aparece a opção de salvar; as mudanças valem no próximo deploy."
      />
      {can("project:write") ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          Você pode ver estes ajustes, mas só quem tem permissão de edição pode alterá-los.
        </p>
      )}
      <ProjectSettingsForm
        key={project.updatedAt}
        projectId={projectId}
        project={project}
        canEdit={can("project:write")}
      >
        {can("project:approve") ? (
          <RepositoryTokenSection projectId={projectId} hasToken={project.hasRepositoryToken} />
        ) : null}
        {can("project:delete") ? <DangerZone projectId={projectId} slug={project.slug} /> : null}
      </ProjectSettingsForm>
    </div>
  );
}

/**
 * One block of the settings page: title and explanation on the left, controls on the right;
 * stacked on narrow screens.
 */
function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  readonly icon: LucideIcon;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid gap-5 p-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-10 md:p-6">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </h3>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/**
 * The project fields split into sections, saved together from a bar that appears once
 * something changes. `children` adds more sections to the same panel, outside the form
 * element because forms cannot nest.
 */
function ProjectSettingsForm({
  projectId,
  project,
  canEdit,
  children,
}: {
  readonly projectId: string;
  readonly project: Parameters<typeof projectToFormValues>[0];
  readonly canEdit: boolean;
  readonly children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const form = useProjectForm({
    initialValues: projectToFormValues(project),
    onSubmit: async (values) => {
      try {
        await updateProjectFn({ data: { projectId, project: values } });
        toast.success("Projeto atualizado");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
          queryClient.invalidateQueries({ queryKey: ["projects"] }),
        ]);
      } catch (error) {
        toast.error(toUserMessage(error, "Não foi possível salvar."));
      }
    },
  });

  return (
    <>
      <div className="divide-y divide-border/70 rounded-xl bg-card ring-1 ring-border/70">
        <form
          id={SETTINGS_FORM_ID}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <fieldset disabled={canEdit === false} className="min-w-0 divide-y divide-border/70">
            <SettingsSection
              icon={IdCardIcon}
              title="Geral"
              description="Nome exibido no painel e identificador usado no contêiner e no domínio automático."
            >
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                <IdentityFields form={form} />
              </div>
            </SettingsSection>
            <SettingsSection
              icon={GitBranchIcon}
              title="Repositório"
              description="De onde vem o código e quando um deploy começa sozinho."
            >
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                <RepositoryFields form={form} />
                <AutoDeployField form={form} className="sm:col-span-2" />
                <form.Subscribe
                  selector={(state) => state.values.repositoryUrl !== project.repositoryUrl}
                >
                  {(repositoryChanged) =>
                    repositoryChanged ? (
                      <p
                        role="status"
                        className="flex items-start gap-2 text-sm text-muted-foreground sm:col-span-2"
                      >
                        <TriangleAlertIcon
                          aria-hidden
                          className="mt-0.5 size-4 shrink-0 text-warning"
                        />
                        Trocar o repositório exige nova aprovação de um administrador antes do
                        próximo deploy.
                      </p>
                    ) : null
                  }
                </form.Subscribe>
              </div>
            </SettingsSection>
            <SettingsSection
              icon={HammerIcon}
              title="Build e execução"
              description="Como a imagem é construída e como o painel confere que a aplicação subiu."
            >
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                <PortField form={form} />
                <HealthCheckField form={form} />
                <BuildFields form={form} />
              </div>
            </SettingsSection>
          </fieldset>
        </form>
        {children}
      </div>
      <form.Subscribe selector={(state) => [state.isDefaultValue, state.isSubmitting] as const}>
        {([isDefaultValue, isSubmitting]) =>
          isDefaultValue ? null : (
            <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-lg bg-popover p-3 shadow-lg ring-1 ring-border sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium" aria-live="polite">
                Alterações não salvas
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => form.reset()}
                >
                  <Undo2Icon aria-hidden />
                  Descartar
                </Button>
                <Button
                  type="submit"
                  form={SETTINGS_FORM_ID}
                  disabled={canEdit === false || isSubmitting}
                >
                  {isSubmitting ? (
                    <LoaderCircleIcon aria-hidden className="animate-spin" />
                  ) : (
                    <SaveIcon aria-hidden />
                  )}
                  Salvar alterações
                </Button>
              </div>
            </div>
          )
        }
      </form.Subscribe>
    </>
  );
}

function RepositoryTokenSection({
  projectId,
  hasToken,
}: {
  readonly projectId: string;
  readonly hasToken: boolean;
}) {
  const [token, setToken] = useState("");
  const invalidate = [["project", projectId]] as const;
  const save = useAction({
    action: (value: string | null) => setRepositoryTokenFn({ data: { projectId, token: value } }),
    successMessage: (_result) => "Credencial atualizada",
    invalidate,
    onSuccess: () => setToken(""),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (token.trim() === "") {
      return;
    }
    save.mutate(token.trim());
  };
  return (
    <SettingsSection
      icon={KeyRoundIcon}
      title="Repositório privado"
      description={
        <>
          Token de leitura do GitHub (permissão “Contents: read”). Fica criptografado e nunca é
          exibido.
        </>
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        <Tag icon={hasToken ? CircleCheckIcon : CircleDashedIcon}>
          {hasToken ? "Token salvo" : "Sem token"}
        </Tag>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="repository-token">{hasToken ? "Substituir token" : "Token"}</Label>
            <Input
              id="repository-token"
              type="password"
              autoComplete="off"
              placeholder="github_pat_…"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={save.isPending || token.trim() === ""}>
            <SaveIcon aria-hidden />
            Salvar token
          </Button>
          {hasToken ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="outline" disabled={save.isPending}>
                  <Trash2Icon aria-hidden />
                  Remover
                </Button>
              }
              title="Remover o token?"
              description="Deploys de repositórios privados vão falhar até um novo token ser salvo."
              confirmLabel="Remover"
              destructive
              onConfirm={() => save.mutate(null)}
            />
          ) : null}
        </div>
      </form>
    </SettingsSection>
  );
}

function DangerZone({ projectId, slug }: { readonly projectId: string; readonly slug: string }) {
  const navigate = useNavigate();
  const remove = useAction({
    action: () => deleteProjectFn({ data: { projectId } }),
    successMessage: "Projeto em remoção; o worker vai apagar contêineres e imagens",
    invalidate: [["projects"]],
    onSuccess: async () => {
      await navigate({ to: "/projects" });
    },
  });
  return (
    <SettingsSection
      icon={TriangleAlertIcon}
      title={<span className="text-destructive">Zona de perigo</span>}
      description="Ações que não podem ser desfeitas."
    >
      <div className="flex flex-col gap-4 rounded-lg p-4 ring-1 ring-destructive/40 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">Excluir projeto</p>
          <p className="text-sm text-muted-foreground">
            Remove o projeto, seus contêineres, imagens, variáveis, tasks e histórico.
          </p>
        </div>
        <ConfirmDialog
          trigger={
            <Button
              variant="outline"
              className="shrink-0 text-destructive"
              disabled={remove.isPending}
            >
              <Trash2Icon aria-hidden />
              Excluir projeto
            </Button>
          }
          title="Excluir este projeto?"
          description="A aplicação sai do ar e todos os dados do projeto são apagados."
          confirmLabel="Excluir definitivamente"
          destructive
          confirmationText={slug}
          onConfirm={() => remove.mutate()}
        />
      </div>
    </SettingsSection>
  );
}
