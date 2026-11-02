import { useQuery } from "@tanstack/react-query";

import { useAction } from "@/web/components/layout/use-action";
import {
  listConsoleCommandsFn,
  runConsoleCommandFn,
} from "@/web/functions/console/console.functions";

/** While a command waits or runs, its output is read again this often. */
const RUNNING_REFRESH_IN_MS = 1000;

/** The signed-in user's console on a project: their commands and the action that runs one. */
export function useConsole(projectId: string) {
  const commands = useQuery({
    queryKey: ["console", projectId],
    queryFn: () => listConsoleCommandsFn({ data: { projectId } }),
    refetchInterval: (query) =>
      query.state.data?.some(
        (command) => command.status === "queued" || command.status === "running",
      ) === true
        ? RUNNING_REFRESH_IN_MS
        : false,
  });
  const run = useAction({
    action: (command: string) => runConsoleCommandFn({ data: { projectId, command } }),
    invalidate: [["console", projectId]],
  });
  return { commands, run };
}
