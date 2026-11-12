import { describe, expect, test } from "bun:test";

import { systemSettingsSchema } from "./settings.schema";

const BASE = {
  organizationName: "Nelcota",
  baseDomain: "",
  httpsByDefault: true,
  requireAdminTwoFactor: false,
};

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

  test.each([
    ["ftp://example.com/hook"],
    ["http://hooks.slack.com/services/T/B/x"],
    ["https://localhost/hook"],
    ["https://api.localhost/hook"],
    ["https://service.internal/hook"],
    ["https://node.local/hook"],
    ["https://127.0.0.1/hook"],
    ["https://169.254.169.254/latest/meta-data"],
    ["https://[::1]/hook"],
    ["https://user:secret@hooks.slack.com/services/T/B/x"],
    ["javascript:alert(1)"],
    ["not a url"],
  ])("rejects %p", (alertWebhookUrl) => {
    expect(systemSettingsSchema.safeParse({ ...BASE, alertWebhookUrl }).success).toBe(false);
  });
});
