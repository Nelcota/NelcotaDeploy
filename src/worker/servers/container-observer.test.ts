import { describe, expect, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { requestDeployment } from "@/deployments";
import { managedLabels } from "@/docker";
import { saveDeploymentSecrets, saveEnvironmentVariable } from "@/environments";
import { createLogger } from "@/logging";
import { listRuntimeLogs } from "@/logs";
import { createTestProject, createTestSecretBox, FakeDocker, TEST_ACTOR } from "@/testing";

import { ContainerObserver, parseTimestampedLine } from "./container-observer";

test.each([true, false])(
  "redacts a rotated secret from the live container after restart, snapshot=%p",
  async (withSnapshot) => {
    const database = openMemoryDatabase();
    using _connection = database.$client;
    const project = createTestProject(database);
    const secretBox = await createTestSecretBox();
    const docker = new FakeDocker();
    const deploymentId = requestDeployment(database, {
      projectId: project.id,
      trigger: "manual",
      actor: TEST_ACTOR,
      triggeredByUserId: null,
    }).deploymentId;
    const input = {
      key: "API_KEY",
      kind: "secret" as const,
      value: "old-live-secret",
      availableAtBuild: false,
      excludeFromPreviews: false,
    };
    await saveEnvironmentVariable(database, secretBox, {
      projectId: project.id,
      input,
      actor: TEST_ACTOR,
    });
    await docker.runContainer(
      {
        containerName: "live",
        imageTag: "nelcota/api:test",
        network: "test",
        labels: managedLabels({
          projectId: project.id,
          projectSlug: project.slug,
          deploymentId,
          previewId: null,
        }),
        environmentKeys: [input.key],
        volumes: [],
      },
      { API_KEY: input.value },
    );
    if (withSnapshot) {
      await saveDeploymentSecrets(database, secretBox, { deploymentId, values: [input.value] });
    }
    await saveEnvironmentVariable(database, secretBox, {
      projectId: project.id,
      input: { ...input, value: "new-saved-secret" },
      actor: TEST_ACTOR,
    });
    docker.followContainerLogs = async (_reference, onLine, { signal }) => {
      onLine(`2026-11-01T12:00:00.000Z ${input.value}`, "stdout");
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    };

    {
      using observer = new ContainerObserver({
        serverId: "local",
        database,
        docker,
        secretBox,
        logger: createLogger("test"),
      });
      await observer.refresh();
    }

    expect(
      listRuntimeLogs(database, project.id, { limit: 10 }).map((line) => line.message),
    ).toEqual(["[REDACTED]"]);
  },
);

describe("parseTimestampedLine", () => {
  test("splits docker's nanosecond timestamp from the message", () => {
    const parsed = parseTimestampedLine("2026-10-28T13:45:01.123456789Z GET /health 200");

    expect(parsed).toEqual({ createdAt: "2026-10-28T13:45:01.123Z", message: "GET /health 200" });
  });

  test("returns null for a docker CLI message without timestamp", () => {
    const parsed = parseTimestampedLine(
      "error from daemon in stream: read unix @->/run/docker.sock: use of closed network connection",
    );

    expect(parsed).toBeNull();
  });

  test("returns null when the timestamp is not a valid date", () => {
    const parsed = parseTimestampedLine("2026-13-45T99:99:99Z message");

    expect(parsed).toBeNull();
  });

  test("keeps an empty message when the line is only a timestamp", () => {
    const parsed = parseTimestampedLine("2026-10-28T13:45:01Z");

    expect(parsed).toEqual({ createdAt: "2026-10-28T13:45:01.000Z", message: "" });
  });
});
