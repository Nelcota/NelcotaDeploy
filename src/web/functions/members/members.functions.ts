import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  addProjectMember,
  listProjectMembers,
  removeProjectMember,
  updateProjectMemberRole,
} from "@/access";
import { listUsers, userActor } from "@/auth";
import { getDatabase } from "@/db";
import { PROJECT_ROLES } from "@/shared/roles";
import { authorizeProject } from "@/web/server/authorization";

import { idSchema, projectIdInput } from "../ids";

const memberTarget = z.object({ projectId: idSchema, userId: idSchema });

/** Members of a project and the users an admin could add to it. */
export const listProjectMembersFn = createServerFn({ method: "GET" })
  .validator(projectIdInput)
  .handler(async ({ data }) => {
    await authorizeProject("user:manage", data.projectId);
    const database = getDatabase();
    const members = listProjectMembers(database, data.projectId);
    const memberIds = new Set(members.map((member) => member.userId));
    // Admins reach every project, and disabled accounts cannot sign in.
    const candidates = listUsers(database)
      .filter((user) => user.role !== "admin" && user.disabled === false)
      .filter((user) => memberIds.has(user.id) === false)
      .map((user) => ({ id: user.id, name: user.name, email: user.email }));
    return { members, candidates };
  });

export const addProjectMemberFn = createServerFn({ method: "POST" })
  .validator(memberTarget.extend({ role: z.enum(PROJECT_ROLES) }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("user:manage", data.projectId);
    addProjectMember(getDatabase(), {
      ...data,
      addedByUserId: user.id,
      actor: userActor(user),
    });
  });

export const updateProjectMemberRoleFn = createServerFn({ method: "POST" })
  .validator(memberTarget.extend({ role: z.enum(PROJECT_ROLES) }))
  .handler(async ({ data }) => {
    const user = await authorizeProject("user:manage", data.projectId);
    updateProjectMemberRole(getDatabase(), { ...data, actor: userActor(user) });
  });

export const removeProjectMemberFn = createServerFn({ method: "POST" })
  .validator(memberTarget)
  .handler(async ({ data }) => {
    const user = await authorizeProject("user:manage", data.projectId);
    removeProjectMember(getDatabase(), { ...data, actor: userActor(user) });
  });
