import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { getConfig } from "@/config";
import { getDatabase } from "@/db";
import { getProject } from "@/projects";
import { taskInputSchema, taskRunReviewSchema } from "@/shared/schemas/task.schema";
import {
  createTask,
  deleteTask,
  listTaskExecutions,
  listTasks,
  runTask,
  updateTask,
} from "@/tasks";
import { authorizeProject } from "@/web/server/authorization";

import { idSchema, projectIdInput } from "./ids";

const MAX_EXECUTIONS = 50;

export const listTasksFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorizeProject("project:read", data.projectId);
    const database = getDatabase();
    getProject(database, data.projectId);
    return { tasks: listTasks(database, data.projectId), timeZone: getConfig().SCHEDULE_TIME_ZONE };
  });

export const createTaskFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, task: taskInputSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("task:write", data.projectId);
    return createTask(getDatabase(), {
      projectId: data.projectId,
      input: data.task,
      actor: userActor(user),
      userId: user.id,
      timeZone: getConfig().SCHEDULE_TIME_ZONE,
    });
  });

export const updateTaskFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      projectId: idSchema,
      taskId: idSchema,
      task: taskInputSchema,
      expectedUpdatedAt: z.iso.datetime().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await authorizeProject("task:write", data.projectId);
    updateTask(getDatabase(), {
      projectId: data.projectId,
      taskId: data.taskId,
      expectedUpdatedAt: data.expectedUpdatedAt,
      input: data.task,
      actor: userActor(user),
      timeZone: getConfig().SCHEDULE_TIME_ZONE,
    });
  });

export const deleteTaskFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: idSchema, taskId: idSchema }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("task:write", data.projectId);
    deleteTask(getDatabase(), {
      projectId: data.projectId,
      taskId: data.taskId,
      actor: userActor(user),
    });
  });

export const runTaskFn = createServerFn({ method: "POST" })
  .validator(
    z.object({ projectId: idSchema, taskId: idSchema, expected: taskRunReviewSchema.optional() }),
  )
  .handler(async ({ data }) => {
    const user = await authorizeProject("task:run", data.projectId);
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
    await authorizeProject("project:read", data.projectId);
    return listTaskExecutions(getDatabase(), {
      projectId: data.projectId,
      taskId: data.taskId,
      limit: MAX_EXECUTIONS,
    });
  });
