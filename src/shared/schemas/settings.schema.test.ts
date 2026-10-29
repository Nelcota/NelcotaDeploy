import { describe, expect, test } from "bun:test";

import { systemSettingsSchema } from "./settings.schema";

const BASE = { organizationName: "Nelcota", baseDomain: "", httpsByDefault: true };

describe("alertWebhookUrl", () => {
  test("accepts an https webhook", () => {
    const parsed = systemSettingsSchema.parse({
      ...BASE,
      alertWebhookUrl: " https://hooks.slack.com/services/T/B/x ",
    });

    expect(parsed.alertWebhookUrl).toBe("https://hooks.slack.com/services/T/B/x");
  });

  test("turns a blank value into no webhook", () => {
    expect(
      systemSettingsSchema.parse({ ...BASE, alertWebhookUrl: "  " }).alertWebhookUrl,
    ).toBeNull();
  });

  test.each([["ftp://example.com/hook"], ["javascript:alert(1)"], ["not a url"]])(
    "rejects %p",
    (alertWebhookUrl) => {
      expect(systemSettingsSchema.safeParse({ ...BASE, alertWebhookUrl }).success).toBe(false);
    },
  );
});
