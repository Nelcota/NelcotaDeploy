import type { Task } from "@/tasks";
import { useNow } from "@/web/components/clock/use-now";
import { List } from "@/web/components/layout/layout";

import { TaskListRow, type TaskRow } from "../task-row";
import type { TaskActions } from "./use-tasks";

/** The project's tasks (nothing when there are none), each with its run, toggle, edit and delete controls. */
export function TaskList({
  projectId,
  tasks,
  actions,
  permissions,
  onEdit,
}: {
  readonly projectId: string;
  readonly tasks: readonly TaskRow[];
  readonly actions: TaskActions;
  readonly permissions: { readonly canRun: boolean; readonly canWrite: boolean };
  readonly onEdit: (task: Task) => void;
}) {
  const now = useNow();
  const { toggle, run, remove } = actions;
  if (tasks.length === 0) {
    return null;
  }
  return (
    <List>
      {tasks.map((task) => (
        <TaskListRow
          projectId={projectId}
          key={task.id}
          task={task}
          now={now}
          canRun={permissions.canRun}
          canWrite={permissions.canWrite}
          toggling={toggle.isPending && toggle.variables.task.id === task.id}
          onToggle={(enabled) => toggle.mutate({ task, enabled })}
          running={run.isPending && run.variables.id === task.id}
          onRun={() => run.mutate(task)}
          onEdit={() => onEdit(task)}
          onDelete={() => remove.mutate(task.id)}
        />
      ))}
    </List>
  );
}
