import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  InfoIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import type { EnvironmentVariableView } from "@/environments";
import { environmentVariableInputSchema } from "@/shared/environment-variable.schema";
import { formatDateTime } from "@/shared/format";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { FormField } from "@/web/components/form-field";
import { PageHeader } from "@/web/components/page-header";
import { projectQueryOptions } from "@/web/components/project-query";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { Badge } from "@/web/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
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

type VariableKind = "plain" | "secret";

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
      <PageHeader
        title="Variáveis de ambiente"
        description="Configurações e secrets entregues ao contêiner. Secrets são criptografados (AES-256-GCM) e nunca voltam para o navegador."
        actions={
          canEdit ? (
            <Button onClick={openCreate}>
              <PlusIcon aria-hidden />
              Nova variável
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          As alterações valem a partir do próximo deploy. Use o redeploy para recriar o contêiner
          com a imagem atual e as novas variáveis.
        </p>
        {canRedeploy ? (
          <Button
            variant="outline"
            size="sm"
            disabled={redeploy.isPending}
            onClick={() => redeploy.mutate()}
          >
            <RefreshCwIcon aria-hidden />
            Redeploy agora
          </Button>
        ) : null}
      </div>
      <VariablesTable
        query={variables}
        canEdit={canEdit}
        onEdit={openEdit}
        onDelete={(variableId) => remove.mutate(variableId)}
        onCreate={openCreate}
      />
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

function VariablesTable({
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
        title="Nenhuma variável cadastrada"
        description="Adicione configurações como NODE_ENV ou secrets como DATABASE_URL."
        action={
          canEdit ? (
            <Button variant="outline" onClick={onCreate}>
              <PlusIcon aria-hidden />
              Nova variável
            </Button>
          ) : null
        }
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Valor</TableHead>
            <TableHead>Build</TableHead>
            <TableHead>Atualizada em</TableHead>
            {canEdit ? <TableHead className="text-right">Ações</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.map((variable) => (
            <TableRow key={variable.id}>
              <TableCell className="font-mono text-sm">{variable.key}</TableCell>
              <TableCell>
                <Badge variant={variable.kind === "secret" ? "default" : "secondary"}>
                  {variable.kind === "secret" ? "Secret" : "Configuração"}
                </Badge>
              </TableCell>
              <TableCell
                className="max-w-xs truncate font-mono text-xs"
                title={variable.value ?? undefined}
              >
                {variable.kind === "secret" ? (
                  <span aria-label="Valor oculto">{MASKED_VALUE}</span>
                ) : (
                  (variable.value ?? "")
                )}
              </TableCell>
              <TableCell className="text-sm">
                {variable.availableAtBuild ? "Disponível no build" : "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDateTime(variable.updatedAt)}
              </TableCell>
              {canEdit ? (
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${variable.key}`}
                      onClick={() => onEdit(variable)}
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={`Excluir ${variable.key}`}>
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
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
            Nomes aceitam letras, números e _ e não podem começar com número.
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
                onChange={(event) => update({ key: event.target.value })}
              />
            )}
          </FormField>
          <FormField id="variable-kind" label="Tipo" errors={errors.kind ?? []}>
            {(props) => (
              <Select
                value={draft.kind}
                onValueChange={(value) => update({ kind: value === "secret" ? "secret" : "plain" })}
              >
                <SelectTrigger {...props} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plain">Configuração (valor visível)</SelectItem>
                  <SelectItem value="secret">Secret (criptografado e oculto)</SelectItem>
                </SelectContent>
              </Select>
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
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-1">
              <Label htmlFor="variable-build">Disponível no build</Label>
              <p id="variable-build-hint" className="text-xs text-muted-foreground">
                O valor é passado ao docker build como build arg (ARG no Dockerfile), sem aparecer
                na linha de comando.
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
