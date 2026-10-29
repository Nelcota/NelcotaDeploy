import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { getProject } from "@/projects";
import { taskInputSchema } from "@/shared/schemas/task.schema";
import {
  createTask,
  deleteTask,
  listTaskExecutions,
  listTasks,
  runTask,
  updateTask,
} from "@/tasks";
import { authorize } from "@/web/server/authorization";

import { idSchema, projectIdInput } from "./ids";

const MAX_EXECUTIONS = 50;

export const listTasksFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorize("project:read");
    const database = getDatabase();
    getProject(database, data.projectId);
    return { tasks: listTasks(database, data.projectId), timeZone: getConfig().SCHEDULE_TIME_ZONE };
  });

export const createTaskFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, task: taskInputSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("task:write");
    return createTask(getDatabase(), {
      projectId: data.projectId,
      input: data.task,
      actor: userActor(user),
      userId: user.id,
      timeZone: getConfig().SCHEDULE_TIME_ZONE,
    });
  });

export const updateTaskFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, taskId: idSchema, task: taskInputSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("task:write");
    updateTask(getDatabase(), {
      projectId: data.projectId,
      taskId: data.taskId,
      input: data.task,
      actor: userActor(user),
      timeZone: getConfig().SCHEDULE_TIME_ZONE,
    });
  });

export const deleteTaskFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, taskId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("task:write");
    deleteTask(getDatabase(), {
      projectId: data.projectId,
      taskId: data.taskId,
      actor: userActor(user),
    });
  });

export const runTaskFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, taskId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorize("task:run");
    return runTask(getDatabase(), {
      ...data,
      trigger: "manual",
      actor: userActor(user),
      userId: user.id,
    });
  });

export const listTaskExecutionsFn = createServerFn({ method: "GET" })
  .validator(z.object({ projectId: idSchema, taskId: idSchema }))
  .handler(async ({ data }) => {
    await authorize("project:read");
    return listTaskExecutions(getDatabase(), {
      projectId: data.projectId,
      taskId: data.taskId,
      limit: MAX_EXECUTIONS,
    });
  });
