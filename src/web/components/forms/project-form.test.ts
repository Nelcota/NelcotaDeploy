import { expect, test } from "bun:test";

import { EMPTY_PROJECT_FORM, validateProject } from "./project-form";

const PROJECT = {
  ...EMPTY_PROJECT_FORM,
  name: "Web",
  slug: "web",
  repositoryUrl: "https://github.com/example/web",
};

test("reports each invalid field including advanced settings", () => {
  const errors = validateProject({
    ...PROJECT,
    name: "",
    slug: "",
    internalPort: "70000",
    healthCheckPath: "health",
  });

  expect(errors?.fields).toEqual({
    name: "Campo obrigatório",
    slug: "Campo obrigatório",
    internalPort: "A porta deve ser no máximo 65535",
    healthCheckPath: "O caminho deve começar com / e não conter espaços",
  });
});

test("explains how to correct a nonnumeric port", () => {
  const errors = validateProject({ ...PROJECT, internalPort: "abc" });

  expect(errors?.fields.internalPort).toBe(
    "Informe uma porta com números ou deixe em branco para detectar automaticamente",
  );
});

test("returns no errors for a valid draft", () => {
  expect(validateProject(PROJECT)).toBeUndefined();
});
