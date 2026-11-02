import { describe, expect, test } from "bun:test";

import { ForbiddenError } from "@/auth";
import { openMemoryDatabase } from "@/db";
import { ProjectNotFoundError } from "@/projects";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { createProjectWithStaging, insertUser } from "./access.fixtures";
import {
  accessibleProjectIds,
  assertProjectPermission,
  projectRoleOf,
} from "./project-access.service";
import { addProjectMember } from "./project-member.service";

function setup() {
  const database = openMemoryDatabase();
  const { production, staging } = createProjectWithStaging(database);
  const admin = insertUser(database, "admin", "admin");
  const developer = insertUser(database, "developer", "developer");
  const viewer = insertUser(database, "viewer", "viewer");
  const outsider = insertUser(database, "outsider", "developer");
  for (const [member, role] of [
    [developer, "developer"],
    [viewer, "viewer"],
  ] as const) {
    addProjectMember(database, {
      projectId: production.id,
      userId: member.id,
      role,
      addedByUserId: admin.id,
      actor: TEST_ACTOR,
    });
  }
  return { database, production, staging, admin, developer, viewer, outsider };
}

describe("projectRoleOf", () => {
  test("gives admins the admin role on every project", () => {
    const { database, production, admin } = setup();

    expect(projectRoleOf(database, admin, production.id)).toBe("admin");
  });

  test("gives a member the role of their membership", () => {
    const { database, production, viewer } = setup();

    expect(projectRoleOf(database, viewer, production.id)).toBe("viewer");
  });

  test("gives a staging environment the members of its production project", () => {
    const { database, staging, developer } = setup();

    expect(projectRoleOf(database, developer, staging.id)).toBe("developer");
  });

  test("returns null for a user who is not a member", () => {
    const { database, production, outsider } = setup();

    expect(projectRoleOf(database, outsider, production.id)).toBeNull();
  });

  test("throws ProjectNotFoundError for a project that does not exist", () => {
    const { database, admin } = setup();

    expect(() => projectRoleOf(database, admin, "missing")).toThrow(ProjectNotFoundError);
  });
});

describe("assertProjectPermission", () => {
  test("lets a developer member deploy", () => {
    const { database, production, developer } = setup();

    expect(() =>
      assertProjectPermission(database, developer, {
        projectId: production.id,
        permission: "deployment:create",
      }),
    ).not.toThrow();
  });

  test("lets a viewer member read", () => {
    const { database, production, viewer } = setup();

    expect(() =>
      assertProjectPermission(database, viewer, {
        projectId: production.id,
        permission: "project:read",
      }),
    ).not.toThrow();
  });

  test("throws ForbiddenError when a viewer member tries to deploy", () => {
    const { database, production, viewer } = setup();

    expect(() =>
      assertProjectPermission(database, viewer, {
        projectId: production.id,
        permission: "deployment:create",
      }),
    ).toThrow(ForbiddenError);
  });

  test("throws ForbiddenError when a developer member tries to delete the project", () => {
    const { database, production, developer } = setup();

    expect(() =>
      assertProjectPermission(database, developer, {
        projectId: production.id,
        permission: "project:delete",
      }),
    ).toThrow(ForbiddenError);
  });

  test("throws ProjectNotFoundError for a user who is not a member", () => {
    const { database, production, outsider } = setup();

    expect(() =>
      assertProjectPermission(database, outsider, {
        projectId: production.id,
        permission: "project:read",
      }),
    ).toThrow(ProjectNotFoundError);
  });

  test("lets an admin delete any project", () => {
    const { database, production, admin } = setup();

    expect(() =>
      assertProjectPermission(database, admin, {
        projectId: production.id,
        permission: "project:delete",
      }),
    ).not.toThrow();
  });
});

describe("accessibleProjectIds", () => {
  test("returns null for an admin, who sees every project", () => {
    const { database, admin } = setup();

    expect(accessibleProjectIds(database, admin)).toBeNull();
  });

  test("returns the member's projects and their environments only", () => {
    const { database, production, staging, viewer } = setup();
    createTestProject(database, { name: "Other", slug: "other" });

    const ids = accessibleProjectIds(database, viewer);

    expect(ids?.toSorted()).toEqual([production.id, staging.id].toSorted());
  });

  test("returns an empty list for a user without memberships", () => {
    const { database, outsider } = setup();

    expect(accessibleProjectIds(database, outsider)).toEqual([]);
  });
});
