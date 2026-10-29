import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  EyeIcon,
  HammerIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import type { z } from "zod";

import type { EnvironmentVariableView } from "@/environments";
import { normalizeVariableKey } from "@/shared/dotenv";
import { formatDateTime, formatRelativeTime, pluralize } from "@/shared/format";
import { environmentVariableInputSchema } from "@/shared/schemas/environment-variable.schema";
import { useNow } from "@/web/components/clock/use-now";
import {
  ApplyChangesBanner,
  useApplyChanges,
} from "@/web/components/deployments/apply-changes-banner";
import { EnvImportDialog } from "@/web/components/forms/env-import-dialog";
import { type VariableKind, VariableKindToggle } from "@/web/components/forms/env-kind-toggle";
import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import { filterVariablesByKey } from "@/web/components/forms/variable-filter";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { List, ListRow, Tag } from "@/web/components/layout/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { useAction } from "@/web/components/layout/use-action";
import { TabHeader } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";
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
  const queryClient = useQueryClient();
  // The server compares the variables with what the live container got; refresh that answer.
  const refreshPendingChanges = () => {
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  };

  const remove = useAction({
    action: (variableId: string) =>
      deleteEnvironmentVariableFn({ data: { projectId, variableId } }),
    successMessage: "Variável excluída",
    invalidate: [["environment", projectId]],
    onSuccess: refreshPendingChanges,
  });

  const canRedeploy = project.data?.project.currentDeploymentId != null && can("deployment:create");
  const { redeploy, showBanner: showApplyBanner } = useApplyChanges(
    projectId,
    project.data?.pendingRuntimeChanges === true,
    canRedeploy,
  );

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
        count={variables.data?.length ?? null}
        description={
          <>
            Configurações e secrets entregues ao contêiner. As mudanças valem no próximo deploy
            {variables.data == null ? "." : ` · ${describeKinds(variables.data)}.`}
          </>
        }
        actions={
          <>
            {canEdit ? (
              <>
                <EnvImportDialog projectId={projectId} onImported={refreshPendingChanges} />
                <Button onClick={openCreate}>
                  <PlusIcon aria-hidden />
                  Nova variável
                </Button>
              </>
            ) : null}
          </>
        }
      />
      {showApplyBanner ? (
        <ApplyChangesBanner
          message="As variáveis mudaram. Elas chegam à aplicação quando o contêiner é recriado."
          applying={redeploy.isPending}
          onApply={() => redeploy.mutate()}
        />
      ) : null}
      <VariablesList
        query={variables}
        canEdit={canEdit}
        onCreate={openCreate}
        onEdit={openEdit}
        onDelete={(variableId) => remove.mutate(variableId)}
      />
      <details className="group text-sm text-muted-foreground">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon
            aria-hidden
            className="size-3.5 transition-transform group-open:rotate-90"
          />
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
        onSaved={refreshPendingChanges}
      />
    </>
  );
}

function describeKinds(variables: readonly EnvironmentVariableView[]): string {
  const secrets = variables.filter((variable) => variable.kind === "secret").length;
  const plain = variables.length - secrets;
  return `${pluralize(secrets, "secret", "secrets")}, ${pluralize(plain, "configuração", "configurações")}`;
}

function VariablesList({
  query,
  canEdit,
  onCreate,
  onEdit,
  onDelete,
}: {
  readonly query: ReturnType<typeof useQuery<EnvironmentVariableView[]>>;
  readonly canEdit: boolean;
  readonly onCreate: () => void;
  readonly onEdit: (variable: EnvironmentVariableView) => void;
  readonly onDelete: (variableId: string) => void;
}) {
  const now = useNow();
  const [search, setSearch] = useState("");
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
            <Button size="sm" onClick={onCreate}>
              <PlusIcon aria-hidden />
              Nova variável
            </Button>
          ) : undefined
        }
      />
    );
  }
  const visible = filterVariablesByKey(query.data, search);
  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
        />
        <Input
          type="search"
          aria-label="Buscar variável pelo nome"
          placeholder="Buscar pelo nome"
          className="pl-9"
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <List>
        {visible.length === 0 ? (
          <ListRow>
            <p className="text-sm text-muted-foreground">Nenhuma variável com esse nome.</p>
          </ListRow>
        ) : null}
        {visible.map((variable) => (
          <ListRow key={variable.id} className="flex-wrap sm:flex-nowrap">
            <div className="min-w-0 flex-1 basis-full space-y-1 sm:basis-auto">
              <p className="truncate font-mono text-sm font-medium">{variable.key}</p>
              <p
                className="truncate font-mono text-xs text-muted-foreground"
                title={variable.value ?? undefined}
              >
                {variable.kind === "secret" ? (
                  <>
                    <span aria-hidden>{MASKED_VALUE}</span>
                    <span className="sr-only">Valor oculto</span>
                  </>
                ) : (
                  <PlainValue value={variable.value} />
                )}
              </p>
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs sm:flex-none">
              <Tag icon={variable.kind === "secret" ? LockIcon : EyeIcon}>
                {variable.kind === "secret" ? "Secret" : "Configuração"}
              </Tag>
              {variable.availableAtBuild ? <Tag icon={HammerIcon}>No build</Tag> : null}
              <time
                dateTime={variable.updatedAt}
                title={`Alterada em ${formatDateTime(variable.updatedAt)}`}
                className="hidden w-28 text-right text-muted-foreground md:inline"
              >
                {formatRelativeTime(variable.updatedAt, now)}
              </time>
            </div>
            {canEdit ? (
              <div className="ml-auto flex shrink-0 gap-1">
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
    </div>
  );
}

function VariableDialog({
  projectId,
  open,
  onOpenChange,
  variable,
  onSaved,
}: {
  readonly projectId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly variable: EnvironmentVariableView | null;
  readonly onSaved: () => void;
}) {
  const savedSecret = variable?.kind === "secret";
  // A saved secret keeps its value when left blank; a new one needs a value.
  const schema = environmentVariableInputSchema.refine(
    (input) => input.kind !== "secret" || input.value !== "" || savedSecret,
    { path: ["value"], message: "Informe o valor do secret" },
  );
  const save = useAction({
    action: (input: z.output<typeof environmentVariableInputSchema>) =>
      saveEnvironmentVariableFn({ data: { projectId, variable: input } }),
    successMessage: "Variável salva",
    invalidate: [["environment", projectId]],
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });
  const form = useForm({
    defaultValues:
      variable == null
        ? EMPTY_DRAFT
        : {
            key: variable.key,
            kind: variable.kind,
            value: variable.value ?? "",
            availableAtBuild: variable.availableAtBuild,
          },
    validators: { onChange: schema },
    onSubmit: ({ value }) => save.mutate(schema.parse(value)),
  });

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
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="key">
            {(field) => (
              <FormField
                id="variable-key"
                label="Nome"
                errors={visibleErrors(form, field.state.meta)}
              >
                {(props) => (
                  <Input
                    {...props}
                    className="font-mono"
                    autoComplete="off"
                    disabled={variable != null}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) =>
                      field.handleChange(normalizeVariableKey(event.target.value))
                    }
                  />
                )}
              </FormField>
            )}
          </form.Field>
          <form.Field name="kind">
            {(field) => (
              <FormField
                id="variable-kind"
                label="Tipo"
                errors={visibleErrors(form, field.state.meta)}
              >
                {(props) => (
                  <VariableKindToggle
                    id={props.id}
                    describedBy={props["aria-describedby"]}
                    value={field.state.value}
                    onChange={field.handleChange}
                  />
                )}
              </FormField>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => savedSecret && state.values.kind === "secret"}>
            {(editingSecret) => (
              <form.Field name="value">
                {(field) => (
                  <FormField
                    id="variable-value"
                    label="Valor"
                    hint={editingSecret ? "Deixe em branco para manter o valor atual." : undefined}
                    errors={visibleErrors(form, field.state.meta)}
                  >
                    {(props) => (
                      <Textarea
                        {...props}
                        className="font-mono text-sm"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={editingSecret ? MASKED_VALUE : undefined}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
            )}
          </form.Subscribe>
          <div className="flex items-start justify-between gap-4 rounded-lg bg-secondary p-3 ring-1 ring-border ring-inset">
            <div className="space-y-1">
              <Label htmlFor="variable-build">Disponível no build</Label>
              <p id="variable-build-hint" className="text-xs text-muted-foreground">
                Também entregue ao build da imagem (ARG no Dockerfile).
              </p>
            </div>
            <form.Field name="availableAtBuild">
              {(field) => (
                <Switch
                  id="variable-build"
                  aria-describedby="variable-build-hint"
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                />
              )}
            </form.Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
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
