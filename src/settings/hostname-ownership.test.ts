import { expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { addDomain } from "@/domains";
import { openPreview } from "@/previews";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { assertHostnameOwnership } from "./hostname-ownership";
import { HostnameConflictError } from "./settings.errors";
import { getSystemSettings, saveSystemSettings } from "./settings.service";

test("rejects a custom domain claimed by another project's automatic hostname", () => {
  const database = openMemoryDatabase();
  saveSystemSettings(database, { ...getSystemSettings(database), baseDomain: "apps.example.com" });
  createTestProject(database);
  const other = createTestProject(database, { name: "Other", slug: "other" });

  expect(() =>
    addDomain(database, {
      projectId: other.id,
      input: { hostname: "api.apps.example.com", httpsEnabled: true },
      actor: TEST_ACTOR,
    }),
  ).toThrow(HostnameConflictError);

  expect(database.select({ id: tables.domains.id }).from(tables.domains).all()).toHaveLength(0);
  database.$client.close();
});

test("allows a project's custom HTTPS preference for its own automatic hostname", () => {
  const database = openMemoryDatabase();
  saveSystemSettings(database, { ...getSystemSettings(database), baseDomain: "apps.example.com" });
  const project = createTestProject(database);

  addDomain(database, {
    projectId: project.id,
    input: { hostname: "api.apps.example.com", httpsEnabled: false },
    actor: TEST_ACTOR,
  });

  expect(database.select({ id: tables.domains.id }).from(tables.domains).all()).toHaveLength(1);
  database.$client.close();
});

test("reserves the panel's public hostname", () => {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  addDomain(database, {
    projectId: project.id,
    input: { hostname: "panel.example.com", httpsEnabled: true },
    actor: TEST_ACTOR,
  });

  expect(() =>
    assertHostnameOwnership(database, { baseDomain: null, publicUrl: "https://panel.example.com" }),
  ).toThrow(HostnameConflictError);
  database.$client.close();
});

test("rejects a new automatic address that collides with an active preview", () => {
  const database = openMemoryDatabase();
  saveSystemSettings(database, { ...getSystemSettings(database), baseDomain: "apps.example.com" });
  const project = createTestProject(database);
  openPreview(database, {
    projectId: project.id,
    number: 1,
    branch: "feature",
    headSha: "a".repeat(40),
  });

  expect(() => createTestProject(database, { slug: "api-pr-1", name: "Collision" })).toThrow(
    HostnameConflictError,
  );
  database.$client.close();
});

test("rolls back a base-domain change that creates conflicting routes", () => {
  const database = openMemoryDatabase();
  const project = createTestProject(database);
  createTestProject(database, { name: "Other", slug: "other" });
  addDomain(database, {
    projectId: project.id,
    input: { hostname: "other.apps.example.com", httpsEnabled: true },
    actor: TEST_ACTOR,
  });

  expect(() =>
    saveSystemSettings(database, {
      ...getSystemSettings(database),
      baseDomain: "apps.example.com",
    }),
  ).toThrow(HostnameConflictError);

  expect(getSystemSettings(database).baseDomain).toBeNull();
  database.$client.close();
});
