import type { ProjectFormValues } from "./project-form";

/** Keeps the draft intact while giving inactive build methods valid defaults. */
export function newProjectValues(
  values: ProjectFormValues,
  defaults: ProjectFormValues,
): ProjectFormValues {
  const valuesForBuilder = projectValuesForBuilder(values, defaults);
  if (values.builder === "railpack") {
    return { ...valuesForBuilder, dockerfilePath: defaults.dockerfilePath };
  }

  return valuesForBuilder;
}

/** Keeps the saved values of build fields that are hidden for the selected builder. */
export function projectValuesForBuilder(
  values: ProjectFormValues,
  defaults: ProjectFormValues,
): ProjectFormValues {
  if (values.builder === "compose") {
    return {
      ...values,
      dockerfilePath: defaults.dockerfilePath,
      buildContext: defaults.buildContext,
    };
  }

  return {
    ...values,
    composeFilePath: defaults.composeFilePath,
    composeService: defaults.composeService,
  };
}
