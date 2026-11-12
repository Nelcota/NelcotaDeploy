import { expect, test } from "bun:test";

import type { CommandRunner } from "@/process";

import { LABELS } from "../docker.commands";
import { UnmanagedResourceError } from "../docker.errors";
import { DockerNetworks, PANEL_PROXY_CONTAINER, projectNetworkName } from "./docker-networks";

const PROJECT = "019aa05a-1f3e-79a0-a41a-79c805be4111";
const NAME = projectNetworkName(PROJECT);

function fixture(
  initial: { readonly labels: Record<string, string>; readonly attached: string[] } | null,
) {
  const calls: string[][] = [];
  let network = initial;
  const runner: CommandRunner = async (command) => {
    const [, , action] = command;
    calls.push([...command]);
    const missing = action === "inspect" && network == null;
    if (action === "create") {
      network = {
        labels: {
          [LABELS.managed]: "true",
          [LABELS.projectNetwork]: "true",
          [LABELS.projectId]: PROJECT,
        },
        attached: [],
      };
    }

    const container = command.at(-1);
    if (action === "connect" && network != null && container != null) {
      network.attached.push(container);
    }

    const stdout =
      action === "inspect" && network != null
        ? JSON.stringify([
            {
              Name: NAME,
              Labels: network.labels,
              Containers: Object.fromEntries(
                network.attached.map((name) => [name, { Name: name }]),
              ),
            },
          ])
        : "";
    return await Promise.resolve({
      exitCode: missing ? 1 : 0,
      stdout,
      stderr: missing ? `network ${NAME} not found` : "",
      timedOut: false,
      aborted: false,
    });
  };
  return { calls, networks: new DockerNetworks("docker", runner) };
}

test("creates an owned bridge and attaches ingress only once", async () => {
  const { calls, networks } = fixture(null);

  await networks.ensure(PROJECT);
  await networks.attach(PROJECT, PANEL_PROXY_CONTAINER);
  await networks.attach(PROJECT, PANEL_PROXY_CONTAINER);

  expect(calls.filter((command) => command[2] === "create")).toHaveLength(1);
  expect(calls.filter((command) => command[2] === "connect")).toHaveLength(1);
  expect(calls.some((command) => command.includes(`${LABELS.projectId}=${PROJECT}`))).toBe(true);
});

test("refuses to adopt a bridge without the ownership labels", async () => {
  const { calls, networks } = fixture({ labels: {}, attached: [] });

  const error = await networks.ensure(PROJECT).catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(UnmanagedResourceError);
  expect(calls).toHaveLength(1);
});

test("does not detach a bridge that still contains a workload", async () => {
  const { calls, networks } = fixture({
    labels: {
      [LABELS.managed]: "true",
      [LABELS.projectNetwork]: "true",
      [LABELS.projectId]: PROJECT,
    },
    attached: [PANEL_PROXY_CONTAINER, "application"],
  });

  const error = await networks.remove(PROJECT).catch((cause: unknown) => cause);

  expect(error).toHaveProperty("message", `Project network ${NAME} still has attached workloads`);
  expect(calls).toHaveLength(1);
});
