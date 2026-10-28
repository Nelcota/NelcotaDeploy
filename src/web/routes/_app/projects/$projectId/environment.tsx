import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { EyeIcon, KeyRoundIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import type { EnvironmentVariableView } from "@/environments";
import { normalizeVariableKey } from "@/shared/dotenv";
import { environmentVariableInputSchema } from "@/shared/environment-variable.schema";
import { formatDateTime } from "@/shared/format";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { EnvImportDialog } from "@/web/components/env-import-dialog";
import { type VariableKind, VariableKindToggle } from "@/web/components/env-kind-toggle";
import { FormField } from "@/web/components/form-field";
import { List, ListRow } from "@/web/components/layout";
import { TabHeader } from "@/web/components/project-header";
import { projectQueryOptions } from "@/web/components/project-query";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";
import { Textarea } from "@/web/components/ui/textarea";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import { redeployProjectFn } from "@/web/functions/deployments.functions";
import {
  deleteEnvironmentVariableFn,
  listEnvironmentVariablesFn,
  saveEnvironmentVariableFn,
} from "@/web/functions/environment.functions";

export const Route = createFileRoute("/_app/projects/$projectId/environment")({
  head: () => ({ meta: [{ title: "Variáveis · Nelcota Deploy" }] }),
  component: EnvironmentPage,
});

const MASKED_VALUE = "••••••";

type VariableDraft = {
  readonly key: string;
  readonly kind: VariableKind;
  readonly value: string;
  readonly availableAtBuild: boolean;
};

const EMPTY_DRAFT: VariableDraft = { key: "", kind: "plain", value: "", availableAtBuild: false };

function EnvironmentPage() {
  const { projectId } = Route.useParams();
  const can = useCan();
  const canEdit = can("environment:write");
  const project = useQuery(projectQueryOptions(projectId));
  const variables = useQuery({
    queryKey: ["environment", projectId],
    queryFn: () => listEnvironmentVariablesFn({ data: { projectId } }),
  });
  const [editing, setEditing] = useState<EnvironmentVariableView | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const redeploy = useAction({
    action: () => redeployProjectFn({ data: { projectId } }),
    successMessage: "Redeploy colocado na fila",
    invalidate: [["project", projectId], ["deployments"]],
  });
  const remove = useAction({
    action: (variableId: string) =>
      deleteEnvironmentVariableFn({ data: { projectId, variableId } }),
    successMessage: "Variável excluída",
    invalidate: [["environment", projectId]],
  });

  const canRedeploy = project.data?.project.currentDeploymentId != null && can("deployment:create");

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (variable: EnvironmentVariableView) => {
    setEditing(variable);
    setDialogOpen(true);
  };

  return (
    <>
      <TabHeader
        title="Variáveis"
        description={
          <span>
            Configurações e secrets entregues ao contêiner. As mudanças valem no próximo deploy
            {canRedeploy ? (
              <>
                {" — "}
                <button
                  type="button"
                  disabled={redeploy.isPending}
                  onClick={() => redeploy.mutate()}
                  className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none disabled:opacity-50"
                >
                  redeploy agora
                </button>
              </>
            ) : null}
            .
          </span>
        }
        actions={
          canEdit ? (
            <>
              <EnvImportDialog projectId={projectId} />
              <Button onClick={openCreate}>
                <PlusIcon aria-hidden />
                Nova variável
              </Button>
            </>
          ) : null
        }
      />
      <VariablesList
        query={variables}
        canEdit={canEdit}
        onEdit={openEdit}
        onDelete={(variableId) => remove.mutate(variableId)}
        onCreate={openCreate}
      />
      <details className="group text-sm text-muted-foreground">
        <summary className="w-fit cursor-pointer text-xs font-medium text-faint hover:text-foreground focus-visible:text-foreground focus-visible:outline-none">
          Saiba mais sobre secrets e redeploy
        </summary>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed">
          Secrets são criptografados com AES-256-GCM e nunca voltam para o navegador. O redeploy
          recria o contêiner com a imagem atual e as variáveis salvas, sem novo build.
        </p>
      </details>
      <VariableDialog
        key={editing?.id ?? "new"}
        projectId={projectId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        variable={editing}
      />
    </>
  );
}

function VariablesList({
  query,
  canEdit,
  onEdit,
  onDelete,
  onCreate,
}: {
  readonly query: ReturnType<typeof useQuery<EnvironmentVariableView[]>>;
  readonly canEdit: boolean;
  readonly onEdit: (variable: EnvironmentVariableView) => void;
  readonly onDelete: (variableId: string) => void;
  readonly onCreate: () => void;
}) {
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.data == null) {
    return <ListSkeleton />;
  }
  if (query.data.length === 0) {
    return (
      <EmptyState
        icon={KeyRoundIcon}
        title="Nenhuma variável ainda"
        description="Adicione configurações como NODE_ENV ou secrets como DATABASE_URL."
        action={
          canEdit ? (
            <Button variant="outline" size="sm" onClick={onCreate}>
              <PlusIcon aria-hidden />
              Nova variável
            </Button>
          ) : null
        }
      />
    );
  }
  return (
    <List>
      {query.data.map((variable) => (
        <ListRow key={variable.id} className="flex-wrap sm:flex-nowrap">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate font-mono text-sm font-medium">{variable.key}</p>
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={variable.value ?? undefined}
            >
              {variable.kind === "secret" ? (
                <span aria-label="Valor oculto">{MASKED_VALUE}</span>
              ) : (
                <PlainValue value={variable.value} />
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4 text-xs text-faint">
            <span className="inline-flex items-center gap-1.5">
              {variable.kind === "secret" ? (
                <LockIcon aria-hidden className="size-3.5" />
              ) : (
                <EyeIcon aria-hidden className="size-3.5" />
              )}
              {variable.kind === "secret" ? "Secret" : "Configuração"}
            </span>
            {variable.availableAtBuild ? <span>no build</span> : null}
            <span className="hidden md:inline">{formatDateTime(variable.updatedAt)}</span>
          </div>
          {canEdit ? (
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Editar ${variable.key}`}
                onClick={() => onEdit(variable)}
              >
                <PencilIcon aria-hidden />
              </Button>
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${variable.key}`}>
                    <Trash2Icon aria-hidden />
                  </Button>
                }
                title={`Excluir ${variable.key}?`}
                description="A variável deixa de ser enviada ao contêiner a partir do próximo deploy."
                confirmLabel="Excluir"
                destructive
                onConfirm={() => onDelete(variable.id)}
              />
            </div>
          ) : null}
        </ListRow>
      ))}
    </List>
  );
}

function VariableDialog({
  projectId,
  open,
  onOpenChange,
  variable,
}: {
  readonly projectId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly variable: EnvironmentVariableView | null;
}) {
  const [draft, setDraft] = useState<VariableDraft>(
    variable == null
      ? EMPTY_DRAFT
      : {
          key: variable.key,
          kind: variable.kind,
          value: variable.value ?? "",
          availableAtBuild: variable.availableAtBuild,
        },
  );
  const [errors, setErrors] = useState<Partial<Record<keyof VariableDraft, string[]>>>({});
  const save = useAction({
    action: (input: z.output<typeof environmentVariableInputSchema>) =>
      saveEnvironmentVariableFn({ data: { projectId, variable: input } }),
    successMessage: "Variável salva",
    invalidate: [["environment", projectId]],
    onSuccess: () => onOpenChange(false),
  });
  const editingSecret = variable?.kind === "secret" && draft.kind === "secret";

  const submit = () => {
    const parsed = environmentVariableInputSchema.safeParse(draft);
    if (parsed.success === false) {
      setErrors(z.flattenError(parsed.error).fieldErrors);
      return;
    }
    if (parsed.data.kind === "secret" && parsed.data.value === "" && editingSecret === false) {
      setErrors({ value: ["Informe o valor do secret"] });
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  const update = (patch: Partial<VariableDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{variable == null ? "Nova variável" : `Editar ${variable.key}`}</DialogTitle>
          <DialogDescription>
            O nome vira maiúsculo automaticamente; use letras, números e _.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormField id="variable-key" label="Nome" errors={errors.key ?? []}>
            {(props) => (
              <Input
                {...props}
                className="font-mono"
                autoComplete="off"
                disabled={variable != null}
                value={draft.key}
                onChange={(event) => update({ key: normalizeVariableKey(event.target.value) })}
              />
            )}
          </FormField>
          <FormField id="variable-kind" label="Tipo" errors={errors.kind ?? []}>
            {(props) => (
              <VariableKindToggle
                id={props.id}
                value={draft.kind}
                onChange={(kind) => update({ kind })}
              />
            )}
          </FormField>
          <FormField
            id="variable-value"
            label="Valor"
            hint={editingSecret ? "Deixe em branco para manter o valor atual." : undefined}
            errors={errors.value ?? []}
          >
            {(props) => (
              <Textarea
                {...props}
                className="font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
                placeholder={editingSecret ? MASKED_VALUE : undefined}
                value={draft.value}
                onChange={(event) => update({ value: event.target.value })}
              />
            )}
          </FormField>
          <div className="flex items-start justify-between gap-4 rounded-lg bg-secondary p-3 ring-1 ring-border ring-inset">
            <div className="space-y-1">
              <Label htmlFor="variable-build">Disponível no build</Label>
              <p id="variable-build-hint" className="text-xs text-faint">
                Também entregue ao build da imagem (ARG no Dockerfile).
              </p>
            </div>
            <Switch
              id="variable-build"
              aria-describedby="variable-build-hint"
              checked={draft.availableAtBuild}
              onCheckedChange={(checked) => update({ availableAtBuild: checked })}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PlainValue({ value }: { readonly value: string | null }) {
  if (value == null || value === "") {
    return <span className="text-faint">vazio</span>;
  }
  return <>{value}</>;
}
