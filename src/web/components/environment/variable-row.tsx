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
    <ListRow className="flex-wrap sm:flex-nowrap">
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
