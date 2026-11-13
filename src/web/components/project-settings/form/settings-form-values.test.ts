import { expect, test } from "bun:test";

import { EMPTY_PROJECT_FORM } from "@/web/components/forms/project-form";

import { settingsFormValues } from "./settings-form-values";

test("keeps a build draft while validating against port and previews saved elsewhere", () => {
  const draft = {
    ...EMPTY_PROJECT_FORM,
    builder: "compose",
    composeService: "web",
    previewsEnabled: true,
  } as const;
  const saved = { ...EMPTY_PROJECT_FORM, internalPort: "3000" };

  const values = settingsFormValues(draft, saved, "build");

  expect(values).toEqual({ ...saved, builder: "compose", composeService: "web" });
});
