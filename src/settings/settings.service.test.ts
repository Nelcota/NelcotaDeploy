import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { DEFAULT_SYSTEM_SETTINGS } from "@/shared/schemas/settings.schema";

import { getSystemSettings, saveSystemSettings } from "./settings.service";

const SAVED = {
  organizationName: "Nelcota",
  baseDomain: "apps.example.com",
  httpsByDefault: false,
  alertWebhookUrl: "https://discord.com/api/webhooks/1/abc",
  requireAdminTwoFactor: true,
};

describe("saveSystemSettings", () => {
  test("reads back what was saved", () => {
    const database = openMemoryDatabase();

    saveSystemSettings(database, SAVED);

    expect(getSystemSettings(database, { includeSecrets: true })).toEqual(SAVED);
  });

  test("clears optional settings saved as empty", () => {
    const database = openMemoryDatabase();
    saveSystemSettings(database, SAVED);

    saveSystemSettings(database, { ...SAVED, baseDomain: null, alertWebhookUrl: null });

    expect(getSystemSettings(database).baseDomain).toBeNull();
    expect(getSystemSettings(database, { includeSecrets: true }).alertWebhookUrl).toBeNull();
  });

  test("falls back to the defaults on a fresh database", () => {
    expect(getSystemSettings(openMemoryDatabase())).toEqual(DEFAULT_SYSTEM_SETTINGS);
  });
});

test("omits webhook credentials by default and includes them only when requested", () => {
  const database = openMemoryDatabase();
  const webhook = "https://hooks.example.com/private-token";
  saveSystemSettings(database, { ...DEFAULT_SYSTEM_SETTINGS, alertWebhookUrl: webhook });

  const visible = getSystemSettings(database);

  expect(visible.alertWebhookUrl).toBeNull();
  expect(visible.organizationName).toBe(DEFAULT_SYSTEM_SETTINGS.organizationName);
  expect(getSystemSettings(database, { includeSecrets: false }).alertWebhookUrl).toBeNull();
  expect(getSystemSettings(database, { includeSecrets: true }).alertWebhookUrl).toBe(webhook);
  database.$client.close();
});
