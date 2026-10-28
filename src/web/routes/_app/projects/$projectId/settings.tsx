import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRoundIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { ProjectForm, projectToFormValues } from "@/web/components/project-form";
import { projectQueryOptions } from "@/web/components/project-query";
import { ListSkeleton } from "@/web/components/states";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import {
  deleteProjectFn,
  setRepositoryTokenFn,
  updateProjectFn,
} from "@/web/functions/projects.functions";

export const Route = createFileRoute("/_app/projects/$projectId/settings")({
  component: ProjectSettingsPage,
});

function ProjectSettingsPage() {
  const { projectId } = Route.useParams();
  const details = useQuery(projectQueryOptions(projectId));
  const queryClient = useQueryClient();
  const can = useCan();

  if (details.data == null) {
    return <ListSkeleton rows={6} />;
  }
  const { project } = details.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuração do projeto</CardTitle>
          <CardDescription>
            As mudanças valem a partir do próximo deploy. Trocar o repositório exige nova aprovação
            de um administrador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm
            key={project.updatedAt}
            initialValues={projectToFormValues(project)}
            submitLabel="Salvar alterações"
            disabled={can("project:write") === false}
            onSubmit={async (values) => {
              try {
                await updateProjectFn({ data: { projectId, project: values } });
                toast.success("Projeto atualizado");
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
                  queryClient.invalidateQueries({ queryKey: ["projects"] }),
                ]);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
              }
            }}
          />
        </CardContent>
      </Card>
      {can("project:approve") ? (
        <RepositoryTokenCard projectId={projectId} hasToken={project.hasRepositoryToken} />
      ) : null}
      {can("project:delete") ? <DangerZone projectId={projectId} slug={project.slug} /> : null}
    </div>
  );
}

function RepositoryTokenCard({
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRoundIcon aria-hidden className="size-4" />
          Repositório privado
        </CardTitle>
        <CardDescription>
          Token de leitura (fine-grained, somente “Contents: read”). Fica criptografado e nunca é
          exibido, registrado em logs ou passado em URLs.{" "}
          {hasToken ? "Há um token salvo." : "Nenhum token salvo."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={submit}>
          <div className="flex-1 space-y-2">
            <Label htmlFor="repository-token">{hasToken ? "Substituir token" : "Token"}</Label>
            <Input
              id="repository-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={save.isPending || token.trim() === ""}>
            Salvar token
          </Button>
          {hasToken ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="outline" disabled={save.isPending}>
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
        </form>
      </CardContent>
    </Card>
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
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Zona de perigo</CardTitle>
        <CardDescription>
          Excluir remove o projeto, seus contêineres, imagens, variáveis, tasks e histórico. Não
          pode ser desfeito.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ConfirmDialog
          trigger={
            <Button variant="destructive" disabled={remove.isPending}>
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
      </CardContent>
    </Card>
  );
}
