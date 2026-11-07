import { expect, test } from "bun:test";

import { organizationSettingsChangeSchema } from "./organization-settings.schema";

test("accepts one page and strips settings owned by another page", () => {
  expect(
    organizationSettingsChangeSchema.parse({
      section: "organization",
      settings: {
        organizationName: " Nelcota ",
        alertWebhookUrl: "https://hooks.example.com/injected",
      },
    }),
  ).toEqual({ section: "organization", settings: { organizationName: "Nelcota" } });
});

test.each([
  null,
  {},
  { section: "unknown", settings: {} },
  { section: "organization", settings: { organizationName: " " } },
  { section: "domains", settings: { baseDomain: "invalid domain", httpsByDefault: true } },
  { section: "domains", settings: { baseDomain: "apps.example.com" } },
  { section: "alerts", settings: { alertWebhookUrl: "javascript:alert(1)" } },
])("rejects invalid administration page settings %p", (input) => {
  expect(organizationSettingsChangeSchema.safeParse(input).success).toBe(false);
});
