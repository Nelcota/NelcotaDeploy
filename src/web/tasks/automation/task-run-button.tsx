import { LoaderCircleIcon, PlayIcon } from "lucide-react";

import { formatCommandLine } from "@/shared/command-line";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { Button } from "@/web/components/ui/button";

export function TaskRunButton({
  task,
  pending,
  onRun,
}: {
  readonly task: { readonly name: string; readonly command: readonly string[] };
  readonly pending: boolean;
  readonly onRun: () => void;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`Executar tarefa ${task.name} agora`}
        >
          {pending ? (
            <LoaderCircleIcon aria-hidden className="animate-spin" />
          ) : (
            <PlayIcon aria-hidden />
          )}
          Executar tarefa agora
        </Button>
      }
      title="Executar esta tarefa?"
      description={
        <div className="space-y-2">
          <p>
            {task.name}. O comando será executado no contêiner atual e poderá alterar dados da
            aplicação.
          </p>
          <pre className="overflow-auto font-mono text-xs whitespace-pre-wrap break-all">
            {formatCommandLine(task.command)}
          </pre>
        </div>
      }
      confirmLabel="Executar comando da tarefa agora"
      onConfirm={onRun}
    />
  );
}
