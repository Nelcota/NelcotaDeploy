import { type CommandRunner, type ProcessResult, type RunProcessOptions } from "@/process";

import { EXEC_SCRIPT, STOP_EXEC_SCRIPT } from "./docker-exec-scripts";
import { DockerCommandError, InvalidDockerArgumentError } from "./docker.errors";

const STOP_TIMEOUT_IN_MS = 10_000;
const MAX_TIMEOUT_IN_MS = 2_147_483_647 - STOP_TIMEOUT_IN_MS;

type ExecIdentity = { readonly pid: number; readonly startedAtTicks: string };
type ExecTarget = {
  readonly binary: string;
  readonly containerId: string;
  readonly command: readonly string[];
};

function readIdentity(line: string, marker: string): ExecIdentity | null {
  const [prefix, rawPid, startedAtTicks, extra] = line.split(" ");
  if (prefix !== marker || rawPid == null || startedAtTicks == null || extra != null) {
    return null;
  }
  const pid = Number(rawPid);
  if (
    /^\d+$/.test(rawPid) === false ||
    Number.isSafeInteger(pid) === false ||
    pid <= 1 ||
    /^\d+$/.test(startedAtTicks) === false
  ) {
    return null;
  }
  return { pid, startedAtTicks };
}

function validateExec(target: ExecTarget, timeoutInMs: number): void {
  if (
    target.command.length === 0 ||
    target.command[0]?.trim() === "" ||
    target.command.some((argument) => argument.includes("\0"))
  ) {
    throw new InvalidDockerArgumentError(
      "Container command must have an executable and no NUL bytes",
    );
  }
  if (
    Number.isInteger(timeoutInMs) === false ||
    timeoutInMs < 1 ||
    timeoutInMs > MAX_TIMEOUT_IN_MS
  ) {
    throw new InvalidDockerArgumentError(`Invalid container command timeout in ms: ${timeoutInMs}`);
  }
}

/** Runs a supervised exec; timeout and cancellation stop its descendants inside the container. */
export async function runContainerExec(
  runner: CommandRunner,
  target: ExecTarget,
  options: RunProcessOptions,
): Promise<ProcessResult> {
  validateExec(target, options.timeoutInMs);
  if (options.signal?.aborted === true) {
    return { exitCode: 1, stdout: "", stderr: "", timedOut: false, aborted: true };
  }
  const marker = `NELCOTA_EXEC_${Bun.randomUUIDv7()}`;
  const client = new AbortController();
  const state = {
    identity: null as ExecIdentity | null,
    metadata: "",
    timedOut: false,
    aborted: false,
    stopRequested: false,
    failure: null as unknown,
    stopping: null as Promise<void> | null,
  };
  const stop = () => {
    state.stopRequested = true;
    const identity = state.identity;
    if (identity == null || state.stopping != null) {
      return;
    }
    state.stopping = runner(
      [
        target.binary,
        "container",
        "exec",
        target.containerId,
        "sh",
        "-c",
        STOP_EXEC_SCRIPT,
        "sh",
        String(identity.pid),
        identity.startedAtTicks,
      ],
      { timeoutInMs: STOP_TIMEOUT_IN_MS },
    )
      .then((result) => {
        if (result.exitCode !== 0) {
          state.failure = new DockerCommandError(
            "Could not stop the container command and its descendants",
            result.exitCode,
          );
        }
      })
      .catch((error: unknown) => {
        state.failure = error;
      })
      .finally(() => client.abort());
  };
  const timer = setTimeout(() => {
    state.timedOut = true;
    stop();
  }, options.timeoutInMs);
  const onAbort = () => {
    state.aborted = true;
    stop();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  using _cleanup = {
    [Symbol.dispose]() {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    },
  };
  let result: ProcessResult;
  try {
    result = await runner(
      [
        target.binary,
        "container",
        "exec",
        target.containerId,
        "sh",
        "-c",
        EXEC_SCRIPT,
        "sh",
        marker,
        ...target.command,
      ],
      {
        ...options,
        timeoutInMs: options.timeoutInMs + STOP_TIMEOUT_IN_MS,
        signal: client.signal,
        onLine: (line, stream) => {
          const identity =
            stream === "stderr" && state.identity == null ? readIdentity(line, marker) : null;
          if (identity != null) {
            state.identity = identity;
            state.metadata = `${line}\n`;
            if (state.stopRequested) {
              stop();
            }
            return;
          }
          options.onLine?.(line, stream);
        },
      },
    );
  } catch (error) {
    stop();
    if (state.stopping != null) {
      await state.stopping;
    }
    throw error;
  }
  clearTimeout(timer);
  if (result.timedOut) {
    state.timedOut = true;
    stop();
  }
  if (state.stopping != null) {
    await state.stopping;
  }
  if (state.failure != null) {
    throw new Error("Container command termination could not be confirmed", {
      cause: state.failure,
    });
  }
  if (state.stopRequested && state.identity == null) {
    throw new Error(
      "Container command termination could not be confirmed: process identity was not received",
    );
  }
  return {
    ...result,
    exitCode: state.stopRequested && result.exitCode === 0 ? 1 : result.exitCode,
    stderr: state.metadata === "" ? result.stderr : result.stderr.replace(state.metadata, ""),
    timedOut: state.timedOut,
    aborted: state.aborted,
  };
}
