import { expect, test } from "bun:test";

import { newProjectValues, projectValuesForBuilder } from "./new-project-values";
import { EMPTY_PROJECT_FORM } from "./project-form";

test.each([
  [
    "dockerfile",
    {
      dockerfilePath: "custom/Dockerfile",
      buildContext: "app",
      composeFilePath: "compose.yaml",
      composeService: "",
    },
  ],
  [
    "railpack",
    {
      dockerfilePath: "Dockerfile",
      buildContext: "app",
      composeFilePath: "compose.yaml",
      composeService: "",
    },
  ],
  [
    "compose",
    {
      dockerfilePath: "Dockerfile",
      buildContext: ".",
      composeFilePath: "custom.yaml",
      composeService: "api",
    },
  ],
] as const)("keeps only the build settings used by %s", (builder, buildSettings) => {
  const draft = {
    ...EMPTY_PROJECT_FORM,
    builder,
    dockerfilePath: "custom/Dockerfile",
    buildContext: "app",
    composeFilePath: "custom.yaml",
    composeService: "api",
  };

  const result = newProjectValues(draft, EMPTY_PROJECT_FORM);

  expect(result).toEqual({ ...draft, ...buildSettings });
});

test("preserves the editable Dockerfile path when Railpack is selected in settings", () => {
  const draft = {
    ...EMPTY_PROJECT_FORM,
    builder: "railpack",
    dockerfilePath: "app/Dockerfile",
  } as const;

  const result = projectValuesForBuilder(draft, EMPTY_PROJECT_FORM);

  expect(result.dockerfilePath).toBe("app/Dockerfile");
});
