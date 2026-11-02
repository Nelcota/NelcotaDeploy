import { and, asc, eq } from "drizzle-orm";

import { type Actor, recordAuditEvent } from "@/audit";
import { type Database, tables, type Transaction } from "@/db";
import type { ProjectRole } from "@/shared/roles";

import { InvalidProjectMemberError, ProjectMemberNotFoundError } from "./access.errors";
import { membershipProjectId, type ProjectAccessUser } from "./project-access.service";

/** A user who may open a project, with their role on it. */
export type ProjectMember = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
  readonly role: ProjectRole;
  readonly createdAt: string;
};

type MemberTarget = { readonly projectId: string; readonly userId: string };

/**
 * Lists the members of a project, sorted by name.
 *
 * @param database - Database.
 * @param projectId - A production project or one of its environments, which share its members.
 * @returns The members.
 * @throws {ProjectNotFoundError} When the project does not exist or is being deleted.
 */
export function listProjectMembers(database: Database, projectId: string): ProjectMember[] {
  const rootProjectId = membershipProjectId(database, projectId);
  return database
    .select({
      userId: tables.projectMembers.userId,
      name: tables.users.name,
      email: tables.users.email,
      image: tables.users.image,
      role: tables.projectMembers.role,
      createdAt: tables.projectMembers.createdAt,
    })
    .from(tables.projectMembers)
    .innerJoin(tables.users, eq(tables.users.id, tables.projectMembers.userId))
    .where(eq(tables.projectMembers.projectId, rootProjectId))
    .orderBy(asc(tables.users.name))
    .all();
}

/**
 * Lets a user open a project with a role.
 *
 * @param database - Database.
 * @param input - Project, user, role, who adds them and the audit actor.
 * @throws {ProjectNotFoundError} When the project does not exist or is being deleted.
 * @throws {InvalidProjectMemberError} When the user does not exist, is an admin, who already
 * reaches every project, or is already a member.
 */
export function addProjectMember(
  database: Database,
  input: MemberTarget & {
    readonly role: ProjectRole;
    readonly addedByUserId: string | null;
    readonly actor: Actor;
  },
): void {
  database.transaction((transaction) => {
    const rootProjectId = membershipProjectId(transaction, input.projectId);
    const user = transaction
      .select({ role: tables.users.role })
      .from(tables.users)
      .where(eq(tables.users.id, input.userId))
      .get();
    if (user == null) {
      throw new InvalidProjectMemberError(`user ${input.userId} does not exist`);
    }
    if (user.role === "admin") {
      throw new InvalidProjectMemberError(`user ${input.userId} is an admin`);
    }
    const target = { projectId: rootProjectId, userId: input.userId };
    if (findMemberRole(transaction, target) != null) {
      throw new InvalidProjectMemberError(`user ${input.userId} is already a member`);
    }
    transaction
      .insert(tables.projectMembers)
      .values({
        ...target,
        role: input.role,
        addedByUserId: input.addedByUserId,
        createdAt: new Date().toISOString(),
      })
      .run();
    recordMemberEvent(transaction, {
      actor: input.actor,
      action: "project.member.add",
      metadata: {
        ...target,
        role: input.role,
      },
    });
  });
}

/**
 * Makes the user who created a project a developer of it, so they keep reaching it. Admins
 * already reach every project and are left out.
 *
 * @param database - Database.
 * @param input - New project, its creator and the audit actor.
 * @throws {ProjectNotFoundError} When the project does not exist or is being deleted.
 */
export function addProjectCreator(
  database: Database,
  input: {
    readonly projectId: string;
    readonly creator: ProjectAccessUser;
    readonly actor: Actor;
  },
): void {
  if (input.creator.role === "admin") {
    return;
  }
  addProjectMember(database, {
    projectId: input.projectId,
    userId: input.creator.id,
    role: "developer",
    addedByUserId: input.creator.id,
    actor: input.actor,
  });
}

/**
 * Changes the role of a project member.
 *
 * @param database - Database.
 * @param input - Project, member, new role and the audit actor.
 * @throws {ProjectNotFoundError} When the project does not exist or is being deleted.
 * @throws {ProjectMemberNotFoundError} When the user is not a member of the project.
 */
export function updateProjectMemberRole(
  database: Database,
  input: MemberTarget & { readonly role: ProjectRole; readonly actor: Actor },
): void {
  database.transaction((transaction) => {
    const target = {
      projectId: membershipProjectId(transaction, input.projectId),
      userId: input.userId,
    };
    if (findMemberRole(transaction, target) == null) {
      throw new ProjectMemberNotFoundError(target.projectId, target.userId);
    }
    transaction
      .update(tables.projectMembers)
      .set({ role: input.role })
      .where(memberCondition(target))
      .run();
    recordMemberEvent(transaction, {
      actor: input.actor,
      action: "project.member.role",
      metadata: {
        ...target,
        role: input.role,
      },
    });
  });
}

/**
 * Takes away a member's access to a project and its environments.
 *
 * @param database - Database.
 * @param input - Project, member and the audit actor.
 * @throws {ProjectNotFoundError} When the project does not exist or is being deleted.
 * @throws {ProjectMemberNotFoundError} When the user is not a member of the project.
 */
export function removeProjectMember(
  database: Database,
  input: MemberTarget & { readonly actor: Actor },
): void {
  database.transaction((transaction) => {
    const target = {
      projectId: membershipProjectId(transaction, input.projectId),
      userId: input.userId,
    };
    if (findMemberRole(transaction, target) == null) {
      throw new ProjectMemberNotFoundError(target.projectId, target.userId);
    }
    transaction.delete(tables.projectMembers).where(memberCondition(target)).run();
    recordMemberEvent(transaction, {
      actor: input.actor,
      action: "project.member.remove",
      metadata: target,
    });
  });
}

function memberCondition(target: MemberTarget) {
  return and(
    eq(tables.projectMembers.projectId, target.projectId),
    eq(tables.projectMembers.userId, target.userId),
  );
}

function findMemberRole(transaction: Transaction, target: MemberTarget): ProjectRole | null {
  const member = transaction
    .select({ role: tables.projectMembers.role })
    .from(tables.projectMembers)
    .where(memberCondition(target))
    .get();
  return member?.role ?? null;
}

function recordMemberEvent(
  transaction: Transaction,
  event: {
    readonly actor: Actor;
    readonly action: string;
    readonly metadata: MemberTarget & { readonly role?: ProjectRole };
  },
): void {
  const { actor, action, metadata } = event;
  recordAuditEvent(transaction, {
    actor,
    action,
    targetType: "project",
    targetId: metadata.projectId,
    metadata,
  });
}
