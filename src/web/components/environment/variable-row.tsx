import { EyeIcon, EyeOffIcon, HammerIcon, LockIcon, PencilIcon, Trash2Icon } from "lucide-react";

import type { EnvironmentVariableView } from "@/environments";
import { formatDateTime, formatRelativeTime } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { ListRow, Tag } from "@/web/components/layout/layout";
import { Button } from "@/web/components/ui/button";

import { MASKED_VALUE } from "./variable-draft";

/** One variable: name, value (masked for secrets), tags, age and, for editors, actions. */
export function VariableRow({
  variable,
  canEdit,
  onEdit,
  onDelete,
}: {
  readonly variable: EnvironmentVariableView;
  readonly canEdit: boolean;
  readonly onEdit: (variable: EnvironmentVariableView) => void;
  readonly onDelete: (variableId: string) => void;
}) {
  const now = useNow();
  const secret = variable.kind === "secret";
  return (
    <ListRow className="flex-wrap">
      <div className="min-w-0 flex-1 basis-full space-y-1 sm:basis-auto">
        <p className="truncate font-mono text-sm font-medium">{variable.key}</p>
        <p
          className="truncate font-mono text-xs text-muted-foreground"
          title={variable.value ?? undefined}
        >
          {secret ? <MaskedValue /> : <PlainValue value={variable.value} />}
        </p>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs sm:flex-none">
        <Tag icon={secret ? LockIcon : EyeIcon} tone={secret ? "warning" : "neutral"}>
          {secret ? "Secret" : "Configuração"}
        </Tag>
        {variable.availableAtBuild ? <Tag icon={HammerIcon}>No build</Tag> : null}
        {variable.excludeFromPreviews ? <Tag icon={EyeOffIcon}>Fora dos previews</Tag> : null}
        <time
          dateTime={variable.updatedAt}
          title={`Alterada em ${formatDateTime(variable.updatedAt)}`}
          className="hidden w-28 text-right text-muted-foreground md:inline"
        >
          {formatRelativeTime(variable.updatedAt, now)}
        </time>
      </div>
      {canEdit ? <VariableActions variable={variable} onEdit={onEdit} onDelete={onDelete} /> : null}
    </ListRow>
  );
}

function VariableActions({
  variable,
  onEdit,
  onDelete,
}: {
  readonly variable: EnvironmentVariableView;
  readonly onEdit: (variable: EnvironmentVariableView) => void;
  readonly onDelete: (variableId: string) => void;
}) {
  return (
    <div className="ml-auto flex max-w-full flex-wrap gap-1">
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Editar variável ${variable.key}`}
        onClick={() => onEdit(variable)}
      >
        <PencilIcon aria-hidden />
        Editar variável
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm" aria-label={`Excluir variável ${variable.key}`}>
            <Trash2Icon aria-hidden />
            Excluir variável
          </Button>
        }
        title={`Excluir ${variable.key}?`}
        description="A variável será excluída do projeto. Ela deixará de ser enviada à aplicação quando o contêiner for recriado, automaticamente se essa opção estiver ativada."
        confirmLabel="Excluir variável do projeto"
        destructive
        onConfirm={() => onDelete(variable.id)}
      />
    </div>
  );
}

function MaskedValue() {
  return (
    <>
      <span aria-hidden>{MASKED_VALUE}</span>
      <span className="sr-only">Valor oculto</span>
    </>
  );
}

function PlainValue({ value }: { readonly value: string | null }) {
  if (value == null || value === "") {
    return <span className="text-faint">vazio</span>;
  }
  return <>{value}</>;
}
