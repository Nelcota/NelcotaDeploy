import { expect, test } from "bun:test";

import type { EnvironmentVariableView } from "@/environments";

import { createTemplateDraft } from "./template-draft";

const existing: EnvironmentVariableView = {
  id: "saved",
  key: "AUTH_SECRET",
  value: null,
  kind: "secret",
  availableAtBuild: false,
  excludeFromPreviews: true,
  updatedAt: "2026-11-06T12:00:00Z",
};

test("never replaces or regenerates an existing masked secret", () => {
  const draft = createTemplateDraft([{ key: "AUTH_SECRET", value: "sample" }], {
    variables: [existing],
    applicationUrl: null,
  });

  expect(draft).toEqual([]);
});

test("generates a signing secret but leaves an external provider token pending", () => {
  const drafts = createTemplateDraft(
    [
      { key: "AUTH_SECRET", value: "sample" },
      { key: "PAYMENT_API_KEY", value: "sample" },
    ],
    { variables: [], applicationUrl: null },
  );

  expect(drafts.at(0)?.value).toMatch(/^[a-f0-9]{64}$/);
  expect(drafts.at(0)?.generated).toBe(true);
  expect(drafts.at(1)?.value).toBe("");
  expect(drafts.at(1)?.kind).toBe("secret");
});

test("preserves the template's credential classification after its sample value has been removed", () => {
  const drafts = createTemplateDraft([{ key: "ENDPOINT", kind: "secret", value: "" }], {
    variables: [],
    applicationUrl: null,
  });

  expect(drafts.at(0)?.kind).toBe("secret");
  expect(drafts.at(0)?.value).toBe("");
});

test("fills the application's own URL and literal configuration defaults", () => {
  const drafts = createTemplateDraft(
    [
      { key: "APP_URL", value: "http://localhost:3000" },
      { key: "LOG_LEVEL", value: "info" },
    ],
    { variables: [], applicationUrl: "https://app.example.com" },
  );

  expect(drafts.map((draft) => draft.value)).toEqual(["https://app.example.com", "info"]);
});

test.each(["${EXTERNAL_VALUE}", "$(run-something)", "<your-value>", "change-me", "your-api-key"])(
  "does not fill unresolved placeholder %p",
  (value) => {
    const drafts = createTemplateDraft([{ key: "CUSTOM_VALUE", value }], {
      variables: [],
      applicationUrl: null,
    });

    expect(drafts.at(0)?.value).toBe("");
  },
);
