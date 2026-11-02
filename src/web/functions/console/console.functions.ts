import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { userActor } from "@/auth";
import { listConsoleCommands, MAX_CONSOLE_COMMAND_LENGTH, runConsoleCommand } from "@/console";
import { getDatabase } from "@/db";
import { authorizeProject } from "@/web/server/authorization";

import { idSchema, projectIdInput } from "../ids";

// Running any command in the container can do what a task can, so it takes the same right.
const CONSOLE_PERMISSION = "task:write";

/** The signed-in user's latest console commands on a project, with their output. */
export const listConsoleCommandsFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    const user = await authorizeProject(CONSOLE_PERMISSION, data.projectId);
    return listConsoleCommands(getDatabase(), { projectId: data.projectId, userId: user.id });
  });

/** Queues a command to run once in the project's live container. */
export const runConsoleCommandFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      projectId: idSchema,
      // The service checks the exact limit after trimming; this only bounds the request.
      command: z.string().max(MAX_CONSOLE_COMMAND_LENGTH * 2),
    }),
  )
  .handler(async ({ data }) => {
    const user = await authorizeProject(CONSOLE_PERMISSION, data.projectId);
    return runConsoleCommand(getDatabase(), {
      projectId: data.projectId,
      command: data.command,
      userId: user.id,
      actor: userActor(user),
    });
  });
