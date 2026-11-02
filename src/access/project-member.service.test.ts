import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openMemoryDatabase, tables } from "@/db";
import { ProjectNotFoundError } from "@/projects";
import { TEST_ACTOR } from "@/testing";

import { InvalidProjectMemberError, ProjectMemberNotFoundError } from "./access.errors";
import { createProjectWithStaging, insertUser } from "./access.fixtures";
import {
  addProjectCreator,
  addProjectMember,
  listProjectMembers,
  removeProjectMember,
  updateProjectMemberRole,
} from "./project-member.service";

function setup() {
  const database = openMemoryDatabase();
  const { production, staging } = createProjectWithStaging(database);
  const admin = insertUser(database, "admin", "admin");
  const developer = insertUser(database, "developer", "developer");
  return { database, production, staging, admin, developer };
}

function auditActions(database: ReturnType<typeof openMemoryDatabase>): string[] {
  return database
    .select({ action: tables.auditEvents.action })
    .from(tables.auditEvents)
    .where(eq(tables.auditEvents.targetType, "project"))
    .all()
    .map((event) => event.action);
}

describe("addProjectMember", () => {
  test("adds the user with the role and records it in the audit log", () => {
    const { database, production, admin, developer } = setup();

    addProjectMember(database, {
      projectId: production.id,
      userId: developer.id,
      role: "viewer",
      addedByUserId: admin.id,
      actor: TEST_ACTOR,
    });

    expect(listProjectMembers(database, production.id)).toMatchObject([
      { userId: developer.id, email: "developer@example.com", role: "viewer" },
    ]);
    expect(auditActions(database)).toContain("project.member.add");
  });

  test("adds a member through a staging environment to its production project", () => {
    const { database, production, staging, developer } = setup();

    addProjectMember(database, {
      projectId: staging.id,
      userId: developer.id,
      role: "developer",
      addedByUserId: null,
      actor: TEST_ACTOR,
    });

    expect(listProjectMembers(database, production.id)).toHaveLength(1);
  });

  test("throws InvalidProjectMemberError for an admin", () => {
    const { database, production, admin } = setup();

    expect(() =>
      addProjectMember(database, {
        projectId: production.id,
        userId: admin.id,
        role: "developer",
        addedByUserId: null,
        actor: TEST_ACTOR,
      }),
    ).toThrow(InvalidProjectMemberError);
  });

  test("throws InvalidProjectMemberError for a user that does not exist", () => {
    const { database, production } = setup();

    expect(() =>
      addProjectMember(database, {
        projectId: production.id,
        userId: "missing",
        role: "viewer",
        addedByUserId: null,
        actor: TEST_ACTOR,
      }),
    ).toThrow(InvalidProjectMemberError);
  });

  test("throws InvalidProjectMemberError for a user who is already a member", () => {
    const { database, production, developer } = setup();
    const member = {
      projectId: production.id,
      userId: developer.id,
      role: "viewer",
      addedByUserId: null,
      actor: TEST_ACTOR,
    } as const;
    addProjectMember(database, member);

    expect(() => addProjectMember(database, member)).toThrow(InvalidProjectMemberError);
  });

  test("throws ProjectNotFoundError for a project that does not exist", () => {
    const { database, developer } = setup();

    expect(() =>
      addProjectMember(database, {
        projectId: "missing",
        userId: developer.id,
        role: "viewer",
        addedByUserId: null,
        actor: TEST_ACTOR,
      }),
    ).toThrow(ProjectNotFoundError);
  });
});

describe("addProjectCreator", () => {
  test("makes a non-admin creator a developer of the project", () => {
    const { database, production, developer } = setup();

    addProjectCreator(database, {
      projectId: production.id,
      creator: developer,
      actor: TEST_ACTOR,
    });

    expect(listProjectMembers(database, production.id)).toMatchObject([
      { userId: developer.id, role: "developer" },
    ]);
  });

  test("leaves out an admin creator, who already reaches every project", () => {
    const { database, production, admin } = setup();

    addProjectCreator(database, { projectId: production.id, creator: admin, actor: TEST_ACTOR });

    expect(listProjectMembers(database, production.id)).toEqual([]);
  });
});

describe("updateProjectMemberRole", () => {
  test("changes the role of a member", () => {
    const { database, production, developer } = setup();
    addProjectMember(database, {
      projectId: production.id,
      userId: developer.id,
      role: "viewer",
      addedByUserId: null,
      actor: TEST_ACTOR,
    });

    updateProjectMemberRole(database, {
      projectId: production.id,
      userId: developer.id,
      role: "developer",
      actor: TEST_ACTOR,
    });

    expect(listProjectMembers(database, production.id)[0]?.role).toBe("developer");
  });

  test("throws ProjectMemberNotFoundError for a user who is not a member", () => {
    const { database, production, developer } = setup();

    expect(() =>
      updateProjectMemberRole(database, {
        projectId: production.id,
        userId: developer.id,
        role: "developer",
        actor: TEST_ACTOR,
      }),
    ).toThrow(ProjectMemberNotFoundError);
  });
});

describe("removeProjectMember", () => {
  test("removes the member and records it in the audit log", () => {
    const { database, production, developer } = setup();
    addProjectMember(database, {
      projectId: production.id,
      userId: developer.id,
      role: "viewer",
      addedByUserId: null,
      actor: TEST_ACTOR,
    });

    removeProjectMember(database, {
      projectId: production.id,
      userId: developer.id,
      actor: TEST_ACTOR,
    });

    expect(listProjectMembers(database, production.id)).toEqual([]);
    expect(auditActions(database)).toContain("project.member.remove");
  });

  test("throws ProjectMemberNotFoundError for a user who is not a member", () => {
    const { database, production, developer } = setup();

    expect(() =>
      removeProjectMember(database, {
        projectId: production.id,
        userId: developer.id,
        actor: TEST_ACTOR,
      }),
    ).toThrow(ProjectMemberNotFoundError);
  });
});
