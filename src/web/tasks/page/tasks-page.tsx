import { useState } from "react";

import type { Task } from "@/tasks";
import { useCan } from "@/web/components/shell/use-permissions";

import { TaskDialog } from "../task-dialog";
import type { TaskRow } from "../task-row";
import { TaskList } from "./task-list";
import { NewTaskButton, TasksHeader, TasksQueryState } from "./tasks-page-states";
import { useTaskActions, useTasksQuery } from "./use-tasks";

/** Manages task definitions and requests runs; execution histories use dedicated routes. */
export function TasksPage({ projectId }: { readonly projectId: string }) {
  const can = useCan();
  const permissions = { canRun: can("task:run"), canWrite: can("task:write") };
  const tasksQuery = useTasksQuery(projectId);
  const actions = useTaskActions(projectId);
  const { dialogTask, dialogOpen, setDialogOpen, openDialog } = useTaskDialog();
  const timeZone = tasksQuery.data?.timeZone ?? "UTC";
  const tasks: readonly TaskRow[] = tasksQuery.data?.tasks ?? [];
  const createButton = (size: "default" | "sm") =>
    permissions.canWrite ? <NewTaskButton size={size} onClick={() => openDialog(null)} /> : null;

  return (
    <>
      <TasksHeader
        count={tasksQuery.data == null ? null : tasks.length}
        action={createButton("default")}
      />
      <TasksQueryState
        query={tasksQuery}
        isEmpty={tasks.length === 0}
        emptyAction={createButton("sm")}
      />
      <TaskList
        projectId={projectId}
        tasks={tasks}
        actions={actions}
        permissions={permissions}
        onEdit={openDialog}
      />
      {dialogOpen ? (
        <TaskDialog
          key={dialogTask?.id ?? "new"}
          projectId={projectId}
          task={dialogTask}
          timeZone={timeZone}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      ) : null}
    </>
  );
}

/** Which task the create/edit dialog shows (null for a new one) and whether it is open. */
function useTaskDialog() {
  const [dialogTask, setDialogTask] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const openDialog = (task: Task | null) => {
    setDialogTask(task);
    setDialogOpen(true);
  };
  return { dialogTask, dialogOpen, setDialogOpen, openDialog };
}
