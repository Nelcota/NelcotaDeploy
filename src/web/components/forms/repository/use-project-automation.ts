import { useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  isValidBranchName,
  isSafeRelativePath,
  parseGitHubRepository,
  slugify,
} from "@/shared/schemas/project.schema";
import {
  inspectRepositoryFn,
  suggestProjectSlugFn,
  getRepositoryHealthCheckFn,
} from "@/web/functions/repository/repository.functions";

import type { ProjectFormApi, ProjectFormValues } from "../project-form";
import { identityFromRepository } from "../repository-identity";
import { preferredDockerfile } from "./repository-defaults";

type AutomaticField =
  | "name"
  | "slug"
  | "branch"
  | "dockerfilePath"
  | "buildContext"
  | "healthCheckPath";
const DETECTION_DELAY_IN_MS = 350;
const STALE_TIME_IN_MS = 300_000;
const MAX_NAME_LENGTH = 64;

function useDebouncedValue(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setSettled(value), DETECTION_DELAY_IN_MS);
    return () => clearTimeout(timeout);
  }, [value]);
  return settled;
}

/** Keeps discovery read-only and stops replacing a field as soon as it is customized. */
export function useProjectAutomation(
  form: ProjectFormApi,
  initialValues: ProjectFormValues,
  options: { readonly projectId?: string | undefined; readonly enabled?: boolean | undefined } = {},
) {
  const { projectId, enabled = true } = options;
  const [manualFields, setManualFields] = useState<ReadonlySet<AutomaticField>>(
    () =>
      new Set<AutomaticField>(
        initialValues.repositoryUrl === ""
          ? []
          : ["name", "slug", "branch", "dockerfilePath", "buildContext", "healthCheckPath"],
      ),
  );
  const repositoryUrl = useStore(form.store, (state) => state.values.repositoryUrl);
  const branch = useStore(form.store, (state) => state.values.branch);
  const name = useStore(form.store, (state) => state.values.name);
  const dockerfilePath = useStore(form.store, (state) => state.values.dockerfilePath);
  const buildContext = useStore(form.store, (state) => state.values.buildContext);
  const settledUrl = useDebouncedValue(repositoryUrl);
  const settledName = useDebouncedValue(name.trim());
  const settledBranch = useDebouncedValue(branch);
  const settledDockerfile = useDebouncedValue(dockerfilePath);
  const settledContext = useDebouncedValue(buildContext);
  const repository = parseGitHubRepository(settledUrl);
  const selectedBranch = manualFields.has("branch") ? settledBranch : undefined;
  const inspection = useQuery({
    queryKey: ["repository-inspection", projectId ?? null, repository?.fullName, selectedBranch],
    queryFn: () =>
      inspectRepositoryFn({
        data: { repositoryUrl: settledUrl, branch: selectedBranch, projectId },
      }),
    enabled:
      enabled &&
      repository != null &&
      (selectedBranch == null || isValidBranchName(selectedBranch)),
    staleTime: STALE_TIME_IN_MS,
    retry: false,
  });
  const suggestion = useQuery({
    queryKey: ["project-slug-suggestion", settledName],
    queryFn: () => suggestProjectSlugFn({ data: { name: settledName } }),
    enabled:
      enabled &&
      manualFields.has("slug") === false &&
      slugify(settledName) !== "" &&
      settledName.length <= MAX_NAME_LENGTH,
    staleTime: 0,
  });
  const healthCheck = useQuery({
    queryKey: [
      "repository-health-check",
      projectId ?? null,
      repository?.fullName,
      settledBranch,
      settledDockerfile,
      settledContext,
    ],
    queryFn: () =>
      getRepositoryHealthCheckFn({
        data: {
          repositoryUrl: settledUrl,
          projectId,
          branch: settledBranch,
          dockerfilePath: settledDockerfile,
          buildContext: settledContext,
        },
      }),
    enabled:
      enabled &&
      repository != null &&
      inspection.data?.fullName === repository.fullName &&
      inspection.data.branch === settledBranch &&
      isValidBranchName(settledBranch) &&
      isSafeRelativePath(settledDockerfile) &&
      isSafeRelativePath(settledContext),
    staleTime: STALE_TIME_IN_MS,
    retry: false,
  });

  useEffect(() => {
    if (manualFields.has("healthCheckPath")) {
      return;
    }
    const data = healthCheck.data;
    if (
      data == null ||
      data.fullName !== parseGitHubRepository(repositoryUrl)?.fullName ||
      data.branch !== branch ||
      data.dockerfilePath !== dockerfilePath
    ) {
      form.setFieldValue("healthCheckPath", "");
      return;
    }
    form.setFieldValue("healthCheckPath", data.path ?? "");
  }, [form, manualFields, healthCheck.data, repositoryUrl, branch, dockerfilePath]);

  useEffect(() => {
    const identity = identityFromRepository(repositoryUrl, {
      name: manualFields.has("name") ? form.getFieldValue("name") : "",
      slug: manualFields.has("slug") ? form.getFieldValue("slug") : "",
    });
    if (identity.name != null && manualFields.has("name") === false) {
      form.setFieldValue("name", identity.name.slice(0, MAX_NAME_LENGTH));
    }
    if (identity.slug != null && manualFields.has("slug") === false) {
      form.setFieldValue("slug", slugify(form.getFieldValue("name")));
    }
  }, [form, repositoryUrl, manualFields]);

  useEffect(() => {
    const data = inspection.data;
    if (data == null || data.fullName !== parseGitHubRepository(repositoryUrl)?.fullName) {
      return;
    }
    if (manualFields.has("branch") === false) {
      form.setFieldValue("branch", data.defaultBranch);
    }
    if (manualFields.has("dockerfilePath") === false) {
      form.setFieldValue(
        "dockerfilePath",
        preferredDockerfile(data.dockerfiles, data.pathsLimited),
      );
    }
  }, [form, inspection.data, repositoryUrl, manualFields]);

  useEffect(() => {
    if (
      suggestion.data != null &&
      manualFields.has("slug") === false &&
      suggestion.data.name === form.getFieldValue("name").trim()
    ) {
      form.setFieldValue("slug", suggestion.data.slug);
    }
  }, [form, suggestion.data, manualFields, name]);

  const markEdited = (field: AutomaticField) =>
    setManualFields((current) => current.union(new Set([field])));
  const isDetecting =
    inspection.isFetching ||
    suggestion.isFetching ||
    healthCheck.isFetching ||
    settledDockerfile !== dockerfilePath ||
    settledContext !== buildContext ||
    settledUrl !== repositoryUrl ||
    settledName !== name.trim() ||
    (manualFields.has("branch") && settledBranch !== branch);
  const useDetectedHealthCheck = () => {
    if (isDetecting || healthCheck.isError || healthCheck.data == null) {
      return;
    }
    form.setFieldValue("healthCheckPath", healthCheck.data.path ?? "");
    setManualFields((current) => current.difference(new Set(["healthCheckPath"])));
  };
  return {
    inspection,
    suggestion,
    healthCheck,
    useDetectedHealthCheck,
    manualFields,
    markEdited,
    isDetecting,
  };
}

export type ProjectAutomation = ReturnType<typeof useProjectAutomation>;
