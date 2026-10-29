import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { DEFAULT_SYSTEM_SETTINGS } from "@/shared/schemas/settings.schema";

import { getSystemSettings, saveSystemSettings } from "./settings.service";

const SAVED = {
  organizationName: "Nelcota",
  baseDomain: "apps.example.com",
  httpsByDefault: false,
  alertWebhookUrl: "https://discord.com/api/webhooks/1/abc",
};

describe("saveSystemSettings", () => {
  test("reads back what was saved", () => {
    const database = openMemoryDatabase();

    saveSystemSettings(database, SAVED);

    expect(getSystemSettings(database)).toEqual(SAVED);
  });

  test("clears optional settings saved as empty", () => {
    const database = openMemoryDatabase();
    saveSystemSettings(database, SAVED);

    saveSystemSettings(database, { ...SAVED, baseDomain: null, alertWebhookUrl: null });

    expect(getSystemSettings(database).baseDomain).toBeNull();
    expect(getSystemSettings(database).alertWebhookUrl).toBeNull();
  });

  test("falls back to the defaults on a fresh database", () => {
    expect(getSystemSettings(openMemoryDatabase())).toEqual(DEFAULT_SYSTEM_SETTINGS);
  });
});
