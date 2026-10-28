import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  EyeIcon,
  HammerIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  VariableIcon,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import type { EnvironmentVariableView } from "@/environments";
import { normalizeVariableKey } from "@/shared/dotenv";
import { environmentVariableInputSchema } from "@/shared/environment-variable.schema";
import { formatDateTime, formatRelativeTime, pluralize } from "@/shared/format";
import { ApplyChangesBanner } from "@/web/components/apply-changes-banner";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { EnvImportDialog } from "@/web/components/env-import-dialog";
import { type VariableKind, VariableKindToggle } from "@/web/components/env-kind-toggle";
import { FormField } from "@/web/components/form-field";
import { List, ListRow, Tag } from "@/web/components/layout";
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
import { filterVariablesByKey } from "@/web/components/variable-filter";
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
  // Variables reach the container only when it is recreated, so changes made here wait for it.
  const [pendingApply, setPendingApply] = useState(false);
  const markPending = () => setPendingApply(true);

  const redeploy = useAction({
    action: () => redeployProjectFn({ data: { projectId } }),
    successMessage: "Redeploy colocado na fila",
    invalidate: [["project", projectId], ["deployments"]],
    onSuccess: () => setPendingApply(false),
  });
  const remove = useAction({
    action: (variableId: string) =>
      deleteEnvironmentVariableFn({ data: { projectId, variableId } }),
    successMessage: "Variável excluída",
    invalidate: [["environment", projectId]],
    onSuccess: markPending,
  });

  const canRedeploy = project.data?.project.currentDeploymentId != null && can("deployment:create");
  const showApplyBanner = pendingApply && canRedeploy;

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
        icon={VariableIcon}
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
            {canRedeploy && showApplyBanner === false ? (
              <Button
                variant="outline"
                disabled={redeploy.isPending}
                onClick={() => redeploy.mutate()}
                title="Recria o contêiner com a imagem atual e as variáveis salvas, sem novo build"
              >
                <RefreshCwIcon aria-hidden />
                Aplicar com redeploy
              </Button>
            ) : null}
            {canEdit ? (
              <>
                <EnvImportDialog projectId={projectId} onImported={markPending} />
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
        <summary className="w-fit cursor-pointer rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
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
        onSaved={markPending}
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
  const now = new Date();
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
            <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
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
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
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

  const update = (patch: Partial<VariableDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    // An error stays only until the user changes that field.
    setErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([field]) => Object.hasOwn(patch, field) === false),
      ),
    );
  };

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
                describedBy={props["aria-describedby"]}
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
              <p id="variable-build-hint" className="text-xs text-muted-foreground">
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
