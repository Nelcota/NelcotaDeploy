import { expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { addDomain } from "@/domains";
import { organizationSettingsChangeSchema } from "@/shared/schemas/settings/organization-settings.schema";
import { createTestProject, TEST_ACTOR } from "@/testing";

import { HostnameConflictError } from "./settings.errors";
import { getSystemSettings, saveSystemSettingsSection } from "./settings.service";

test("saving a stale organization page preserves automatic domains and alert credentials", () => {
  const database = openMemoryDatabase();
  using _database = { [Symbol.dispose]: () => database.$client.close() };
  const initial = getSystemSettings(database);
  saveSystemSettingsSection(database, {
    section: "domains",
    settings: { baseDomain: "apps.example.com", httpsByDefault: false },
  });
  saveSystemSettingsSection(database, {
    section: "alerts",
    settings: { alertWebhookUrl: "https://hooks.example.com/token" },
  });

  const saved = saveSystemSettingsSection(
    database,
    organizationSettingsChangeSchema.parse({
      section: "organization",
      settings: { ...initial, organizationName: "Updated" },
    }),
  );

  expect(saved).toEqual({
    organizationName: "Updated",
    baseDomain: "apps.example.com",
    httpsByDefault: false,
    alertWebhookUrl: "https://hooks.example.com/token",
  });
});

test("clearing alerts does not clear automatic domains", () => {
  const database = openMemoryDatabase();
  using _database = { [Symbol.dispose]: () => database.$client.close() };
  saveSystemSettingsSection(database, {
    section: "domains",
    settings: { baseDomain: "apps.example.com", httpsByDefault: true },
  });

  const saved = saveSystemSettingsSection(
    database,
    organizationSettingsChangeSchema.parse({
      section: "alerts",
      settings: { alertWebhookUrl: "" },
    }),
  );

  expect(saved.alertWebhookUrl).toBeNull();
  expect(saved.baseDomain).toBe("apps.example.com");
});

test("throws HostnameConflictError and rolls back conflicting automatic domains", () => {
  const database = openMemoryDatabase();
  using _database = { [Symbol.dispose]: () => database.$client.close() };
  createTestProject(database);
  const other = createTestProject(database, { slug: "other", name: "Other" });
  addDomain(database, {
    projectId: other.id,
    input: { hostname: "api.apps.example.com", httpsEnabled: true },
    actor: TEST_ACTOR,
  });

  expect(() =>
    saveSystemSettingsSection(database, {
      section: "domains",
      settings: { baseDomain: "apps.example.com", httpsByDefault: false },
    }),
  ).toThrow(HostnameConflictError);
  expect(getSystemSettings(database).baseDomain).toBeNull();
});
