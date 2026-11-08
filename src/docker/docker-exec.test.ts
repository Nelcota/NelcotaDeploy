import { expect, test } from "bun:test";

import type { CommandRunner, ProcessResult } from "@/process";

import { runContainerExec } from "./docker-exec";
import { EXEC_SCRIPT, STOP_EXEC_SCRIPT } from "./docker-exec-scripts";
import { InvalidDockerArgumentError } from "./docker.errors";

const SUCCESS: ProcessResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  aborted: false,
};
const TARGET = {
  binary: "docker",
  containerId: "app-id",
  command: ["printf", "%s", "literal; $(touch /tmp/unwanted)"],
};

function runningCommand(
  options: {
    readonly onStart?: () => void;
    readonly delayedIdentity?: boolean;
    readonly stopFails?: boolean;
  } = {},
) {
  const completed = Promise.withResolvers<ProcessResult>();
  const state = { running: false, stop: [] as readonly string[] };
  const runner: CommandRunner = async (command, run) => {
    if (command[6] === STOP_EXEC_SCRIPT) {
      state.stop = command;
      state.running = false;
      completed.resolve({ ...SUCCESS, exitCode: 137 });
      return await Promise.resolve({ ...SUCCESS, exitCode: options.stopFails === true ? 1 : 0 });
    }
    state.running = true;
    if (options.delayedIdentity === true) {
      options.onStart?.();
      await Promise.resolve();
    }
    run.onLine?.(`${command[8] ?? ""} 42 9876`, "stderr");
    if (options.delayedIdentity !== true) {
      options.onStart?.();
    }
    return await completed.promise;
  };
  return { runner, state };
}

test("preserves literal arguments and removes supervisor metadata from streamed and captured logs", async () => {
  const streamed: string[] = [];
  const runner: CommandRunner = (command, options) => {
    expect(command[6]).toBe(EXEC_SCRIPT);
    expect(command.slice(9)).toEqual(TARGET.command);
    const metadata = `${command[8] ?? ""} 42 9876`;
    options.onLine?.(metadata, "stderr");
    options.onLine?.("application error", "stderr");
    return Promise.resolve({ ...SUCCESS, stderr: `${metadata}\napplication error\n` });
  };

  const result = await runContainerExec(runner, TARGET, {
    timeoutInMs: 1000,
    onLine: (line) => streamed.push(line),
  });

  expect(result.stderr).toBe("application error\n");
  expect(streamed).toEqual(["application error"]);
});

test("stops the identified container process tree when its deadline expires", async () => {
  const { runner, state } = runningCommand();

  const result = await runContainerExec(runner, TARGET, { timeoutInMs: 20 });

  expect(result.timedOut).toBe(true);
  expect(result.aborted).toBe(false);
  expect(result.exitCode).not.toBe(0);
  expect(state.running).toBe(false);
  expect(state.stop.slice(0, 4)).toEqual(["docker", "container", "exec", "app-id"]);
  expect(state.stop.slice(-2)).toEqual(["42", "9876"]);
});

test.each([false, true])(
  "cancels the container process even when identity arrives after abort=%p",
  async (delayedIdentity) => {
    const controller = new AbortController();
    const { runner, state } = runningCommand({
      onStart: () => controller.abort(),
      delayedIdentity,
    });

    const result = await runContainerExec(runner, TARGET, {
      timeoutInMs: 1000,
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(state.running).toBe(false);
    expect(state.stop.slice(-2)).toEqual(["42", "9876"]);
  },
);

test("does not start a command whose signal was already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const { runner, state } = runningCommand();

  const result = await runContainerExec(runner, TARGET, {
    timeoutInMs: 1000,
    signal: controller.signal,
  });

  expect(result.aborted).toBe(true);
  expect(state.running).toBe(false);
  expect(state.stop).toEqual([]);
});

test("reports failed termination instead of claiming a timed out command was stopped", async () => {
  const { runner } = runningCommand({ stopFails: true });

  const failure = await runContainerExec(runner, TARGET, { timeoutInMs: 20 }).catch(
    (error: unknown) => error,
  );

  expect(failure).toMatchObject({
    message: "Container command termination could not be confirmed",
  });
});

test.each([
  "1 9876",
  "0 9876",
  "-5 9876",
  "NaN 9876",
  "0x10 9876",
  "9007199254740993 9876",
  "42 invalid",
  "42 9876 extra",
])("refuses to signal an invalid process identity %s", async (identity) => {
  let stops = 0;
  const runner: CommandRunner = (command, options) => {
    if (command[6] === STOP_EXEC_SCRIPT) {
      stops += 1;
    }
    options.onLine?.(`${command[8] ?? ""} ${identity}`, "stderr");
    return Promise.resolve({ ...SUCCESS, exitCode: 1, timedOut: true });
  };

  const failure = await runContainerExec(runner, TARGET, { timeoutInMs: 1000 }).catch(
    (error: unknown) => error,
  );

  expect(failure).toMatchObject({
    message:
      "Container command termination could not be confirmed: process identity was not received",
  });
  expect(stops).toBe(0);
});

test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_647])(
  "rejects invalid command timeout %p",
  async (timeoutInMs) => {
    const { runner, state } = runningCommand();

    const failure = await runContainerExec(runner, TARGET, { timeoutInMs }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(InvalidDockerArgumentError);
    expect(state.running).toBe(false);
  },
);

test.each([
  { command: [] },
  { command: [""] },
  { command: [" "] },
  { command: ["echo", "nul\0argument"] },
])("rejects an invalid command %p", async ({ command }) => {
  const { runner, state } = runningCommand();

  const failure = await runContainerExec(
    runner,
    { ...TARGET, command },
    { timeoutInMs: 1000 },
  ).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(InvalidDockerArgumentError);
  expect(state.running).toBe(false);
});
