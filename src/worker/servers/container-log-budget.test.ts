import { expect, spyOn, test } from "bun:test";

import { openMemoryDatabase } from "@/db";
import { managedLabels, type OutputHandler } from "@/docker";
import { createLogger } from "@/logging";
import { listRuntimeLogs } from "@/logs";
import { createTestProject, createTestSecretBox, FakeDocker } from "@/testing";

import { ContainerObserver } from "./container-observer";

test("bounds retained log text by bytes, reports drops, and redacts before truncating", async () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const docker = new FakeDocker();
  const secret = "sensitive-crossing-cut";
  await docker.runContainer(
    {
      containerName: "live",
      imageTag: "test",
      network: "test",
      environmentKeys: ["API_KEY"],
      volumes: [],
      labels: managedLabels({
        projectId: project.id,
        projectSlug: project.slug,
        deploymentId: "deployment",
        previewId: null,
      }),
    },
    { API_KEY: secret },
  );
  let emit: OutputHandler | undefined;
  docker.followContainerLogs = (_reference, onLine, { signal }) => {
    emit = onLine;
    return new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  };
  const logger = createLogger("test");
  const warnings = spyOn(logger, "warn").mockImplementation(() => undefined);
  using _warnings = { [Symbol.dispose]: () => warnings.mockRestore() };
  const secretBox = await createTestSecretBox();
  {
    using observer = new ContainerObserver({
      serverId: "local",
      database,
      docker,
      logger,
      secretBox,
    });
    await observer.refresh();
    if (emit == null) {
      throw new Error("Log follower did not start");
    }
    const message = "x".repeat(8190) + secret + "y".repeat(50_000);
    for (let index = 0; index < 1000; index += 1) {
      emit(`2026-11-06T12:00:00.000Z ${message}`, "stdout");
    }
  }
  const lines = listRuntimeLogs(database, project.id, { limit: 1000 });
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.length).toBeLessThan(1000);
  let textBytes = 0;
  for (const line of lines) {
    textBytes += line.message.length * 2;
    expect(line.message).not.toContain("sensitive");
    expect(line.message.length).toBeLessThanOrEqual(8193);
  }
  expect(textBytes).toBeLessThanOrEqual(4_194_304);
  expect(warnings).toHaveBeenCalledWith(
    expect.objectContaining({ droppedLines: 1000 - lines.length }),
    "Runtime log buffer capacity exceeded; lines dropped",
  );
});
