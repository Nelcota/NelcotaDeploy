import type { UseQueryResult } from "@tanstack/react-query";
import { InfoIcon, ListChecksIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { Button } from "@/web/components/ui/button";

export function NewTaskButton({
  size,
  onClick,
}: {
  readonly size: "default" | "sm";
  readonly onClick: () => void;
}) {
  return (
    <Button size={size} onClick={onClick}>
      <PlusIcon aria-hidden />
      Nova task
    </Button>
  );
}

/** Error, loading or empty state of the task list; nothing once there are tasks to show. */
export function TasksQueryState({
  query,
  isEmpty,
  emptyAction,
}: {
  readonly query: UseQueryResult<unknown>;
  readonly isEmpty: boolean;
  readonly emptyAction: ReactNode;
}) {
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.data == null) {
    return <ListSkeleton />;
  }
  if (isEmpty === false) {
    return null;
  }
  return (
    <EmptyState
      icon={ListChecksIcon}
      title="Nenhuma task ainda"
      description="Use tasks para migrações, limpezas de cache ou rotinas agendadas."
      action={emptyAction ?? undefined}
    />
  );
}

export function TasksFootnote({ timeZone }: { readonly timeZone: string }) {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-faint">
      <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      Cada comando roda com docker exec no contêiner atual, como lista de argumentos: não passa por
      um shell e nunca executa no servidor host. Agendamentos usam o fuso {timeZone}.
    </p>
  );
}

export function TasksHeader({
  count,
  action,
}: {
  /** Number of tasks, or null while they load. */
  readonly count: number | null;
  readonly action: ReactNode;
}) {
  return (
    <TabHeader
      title="Tasks"
      count={count}
      description="Comandos que rodam dentro do contêiner da aplicação, sob demanda ou agendados."
      actions={action}
    />
  );
}
