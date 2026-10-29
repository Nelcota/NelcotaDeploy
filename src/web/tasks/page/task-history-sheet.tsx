import { Sheet, SheetContent } from "@/web/components/ui/sheet";

import { ExecutionHistory } from "../execution-history";
import type { TaskRow } from "../task-row";

/** Side panel with the past runs of one task; closed while `task` is null. */
export function TaskHistorySheet({
  projectId,
  task,
  canRun,
  running,
  onRun,
  onClose,
}: {
  readonly projectId: string;
  readonly task: TaskRow | null;
  readonly canRun: boolean;
  readonly running: boolean;
  readonly onRun: (taskId: string) => void;
  readonly onClose: () => void;
}) {
  return (
    <Sheet
      open={task != null}
      onOpenChange={(open) => {
        if (open === false) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {task == null ? null : (
          <ExecutionHistory
            projectId={projectId}
            task={task}
            canRun={canRun}
            running={running}
            onRun={() => onRun(task.id)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
