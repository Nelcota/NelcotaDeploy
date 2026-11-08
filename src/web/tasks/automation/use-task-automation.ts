import { useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { projectQueryOptions } from "@/web/components/projects/project-query";
import { getRepositoryTasksFn } from "@/web/functions/repository/automation.functions";

import { useTasksQuery } from "../task-query";
import type { TaskFormApi } from "../use-task-form";
import { taskDefaults } from "./task-defaults";

const DISCOVERY_STALE_TIME_IN_MS = 300_000;

export function useTaskAutomation(
  form: TaskFormApi,
  options: { readonly projectId: string; readonly enabled: boolean },
) {
  const project = useQuery({ ...projectQueryOptions(options.projectId), enabled: options.enabled });
  const tasks = useTasksQuery(options.projectId);
  const [packagePath, setPackagePath] = useState<string | undefined>();
  const [selected, setSelected] = useState<string | null>(null);
  const [manual, setManual] = useState<ReadonlySet<"name" | "commandLine">>(() => new Set());
  const commandLine = useStore(form.store, (state) => state.values.commandLine);
  const discovery = useQuery({
    queryKey: [
      "repository-tasks",
      options.projectId,
      project.data?.project.repositoryUrl,
      project.data?.project.branch,
      project.data?.project.buildContext,
      project.data?.project.dockerfilePath,
      packagePath,
    ],
    queryFn: () => getRepositoryTasksFn({ data: { projectId: options.projectId, packagePath } }),
    enabled: options.enabled && project.data != null,
    staleTime: DISCOVERY_STALE_TIME_IN_MS,
    retry: false,
  });
  const candidates = discovery.isError ? [] : (discovery.data?.scripts ?? []);
  const automatic =
    candidates.length === 1 && discovery.data?.bunDetected === true
      ? (candidates.at(0) ?? null)
      : null;
  const script =
    selected == null
      ? automatic
      : (candidates.find((candidate) => candidate.name === selected) ?? null);
  useEffect(() => {
    if (options.enabled === false || tasks.data == null || tasks.isError || discovery.isError) {
      return;
    }
    const values = taskDefaults({
      script,
      values: form.state.values,
      manual,
      existingNames: tasks.data.tasks.map((task) => task.name),
    });
    if (values.name != null) {
      form.setFieldValue("name", values.name);
    }
    if (values.commandLine != null) {
      form.setFieldValue("commandLine", values.commandLine);
    }
  }, [
    form,
    script,
    manual,
    tasks.data,
    tasks.isError,
    discovery.isError,
    options.enabled,
    commandLine,
  ]);
  const markEdited = (field: "name" | "commandLine") =>
    setManual((current) => current.union(new Set([field])));
  const choosePackage = (path: string) => {
    setPackagePath(path);
    setSelected(null);
  };
  const useSelectedCommand = () => {
    if (script == null) {
      return;
    }
    form.setFieldValue("commandLine", script.commandLine);
    setManual((current) => current.difference(new Set(["commandLine"])));
  };
  return {
    discovery,
    tasks,
    candidates,
    script,
    packagePath,
    choosePackage,
    selectScript: setSelected,
    markEdited,
    manual,
    useSelectedCommand,
  };
}

export type TaskAutomation = ReturnType<typeof useTaskAutomation>;
