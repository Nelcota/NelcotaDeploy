import { expect, test } from "bun:test";

import {
  deploymentFailureAvailability,
  deploymentFailureGuidance,
} from "./deployment-failure-state";

const failed = {
  id: "failed",
  previewId: null,
  previewDeploymentId: null,
  createdAt: "2026-11-12T15:00:00.000Z",
};
const earlier = "2026-11-12T14:00:00.000Z";
const monitored = {
  project: { currentDeploymentId: "live" },
  worker: { online: true },
  containers: [{ deploymentId: "live", state: "running", health: "healthy" }],
};

test("confirms the previous version when an older release is running", () => {
  const result = deploymentFailureAvailability(failed, monitored, earlier);

  expect(result).toBe("A versão anterior continua no ar, segundo o monitoramento.");
});

test("reports a newer version separately when an old failure is opened", () => {
  const result = deploymentFailureAvailability(failed, monitored, "2026-11-12T16:00:00.000Z");

  expect(result).toBe("Outra versão está no ar, segundo o monitoramento.");
});

test("does not infer uptime from a published version when the worker is offline", () => {
  const result = deploymentFailureAvailability(
    failed,
    { ...monitored, worker: { online: false } },
    earlier,
  );

  expect(result).toBe(
    "Há uma versão publicada, mas o painel ainda não confirma que ela esteja no ar.",
  );
});

test("does not infer uptime from an unhealthy replica", () => {
  const containers = [{ deploymentId: "live", state: "running", health: "unhealthy" }];

  const result = deploymentFailureAvailability(failed, { ...monitored, containers }, earlier);

  expect(result).toBe(
    "Há uma versão publicada, mas o painel ainda não confirma que ela esteja no ar.",
  );
});

test("reports an empty preview independently from the live production version", () => {
  const result = deploymentFailureAvailability(
    { ...failed, previewId: "preview" },
    monitored,
    earlier,
  );

  expect(result).toBe("Nenhuma versão está publicada neste ambiente.");
});

test("confirms uptime for the prior version of the same preview", () => {
  const deployment = { ...failed, previewId: "preview", previewDeploymentId: "preview-live" };
  const containers = [
    ...monitored.containers,
    { deploymentId: "preview-live", state: "running", health: null },
  ];

  const result = deploymentFailureAvailability(deployment, { ...monitored, containers }, earlier);

  expect(result).toBe("A versão anterior continua no ar, segundo o monitoramento.");
});

test("leaves the runtime state unconfirmed while project details are missing", () => {
  const result = deploymentFailureAvailability(failed, undefined, null);

  expect(result).toBe("O estado da versão publicada ainda não pôde ser confirmado.");
});

test("identifies the running container when the failed deploy is itself assigned", () => {
  const result = deploymentFailureAvailability({ ...failed, id: "live" }, monitored, earlier);

  expect(result).toBe("O painel detectou um contêiner em execução para este deploy.");
});
test("links a recorded HTTP health check failure to runtime settings", () => {
  expect(deploymentFailureGuidance("health_endpoint")).toMatchObject({ section: "runtime" });
});

test("offers logs for a Docker health check without linking to the panel's probe settings", () => {
  expect(deploymentFailureGuidance("docker_healthcheck")?.section).toBeNull();
});

test("does not guess a configuration shortcut for an unclassified failure", () => {
  expect(deploymentFailureGuidance(null)).toBeNull();
});
