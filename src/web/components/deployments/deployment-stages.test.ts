import { describe, expect, test } from "bun:test";

import {
  deploymentFailureStage,
  stageStates,
} from "@/web/components/deployments/deployment-stages";

const base = { sourceDeploymentId: null, commitSha: null, imageTag: null, containerName: null };

describe("stageStates", () => {
  test("marks earlier stages done and the running one current", () => {
    const states = stageStates({ ...base, status: "building", commitSha: "abc" });

    expect(states).toEqual(["done", "done", "current", "pending", "pending", "pending", "pending"]);
  });

  test("marks every stage done when the deployment succeeded", () => {
    const states = stageStates({
      ...base,
      status: "succeeded",
      commitSha: "abc",
      imageTag: "nelcota/api:1",
      containerName: "nelcota-api-1",
    });

    expect(states).toEqual(["done", "done", "done", "done", "done", "done", "done"]);
  });

  test("skips clone and build for a rollback", () => {
    const states = stageStates({
      ...base,
      status: "starting",
      sourceDeploymentId: "d1",
      imageTag: "x:1",
    });

    expect(states).toEqual([
      "done",
      "skipped",
      "skipped",
      "current",
      "pending",
      "pending",
      "pending",
    ]);
  });
});

describe("stageStates failures", () => {
  test.each([
    ["queued", "Preparação do deploy", 0],
    ["cloning", "Clonagem do repositório", 1],
    ["building", "Construção da imagem", 2],
    ["starting", "Inicialização da aplicação", 3],
    ["health_checking", "Verificação de saúde", 4],
    ["publishing", "Publicação da versão", 5],
  ] as const)(
    "shows the recorded %s failure in the summary and timeline",
    (failureStage, label, index) => {
      const deployment = {
        ...base,
        status: "failed",
        failureStage,
        imageTag: "x:1",
        containerName: "candidate",
      } as const;

      expect(deploymentFailureStage(deployment)).toBe(label);
      expect(stageStates(deployment).indexOf("failed")).toBe(index);
    },
  );

  test("places a failure without commit at the clone stage", () => {
    expect(stageStates({ ...base, status: "failed" })[1]).toBe("failed");
  });

  test("places a failure without image at the build stage", () => {
    expect(stageStates({ ...base, status: "failed", commitSha: "abc" })[2]).toBe("failed");
  });

  test("places a failure with a container at the health check", () => {
    const states = stageStates({
      ...base,
      status: "failed",
      commitSha: "abc",
      imageTag: "x:1",
      containerName: "c",
    });

    expect(states[4]).toBe("failed");
    expect(states[5]).toBe("pending");
  });

  test("shows a cancelled deployment as cancelled at the stage it stopped", () => {
    expect(stageStates({ ...base, status: "cancelled", commitSha: "abc" })[2]).toBe("cancelled");
  });

  test("describes a failed build with the same stage as the timeline", () => {
    const stage = deploymentFailureStage({ ...base, status: "failed", commitSha: "abc" });

    expect(stage).toBe("Construção da imagem");
  });

  test("keeps startup and health check ambiguous when a container name was already assigned", () => {
    const stage = deploymentFailureStage({
      ...base,
      status: "failed",
      imageTag: "x:1",
      containerName: "candidate",
    });

    expect(stage).toBe("Inicialização ou verificação de saúde");
  });

  test("does not report a failure for a cancelled deploy", () => {
    expect(deploymentFailureStage({ ...base, status: "cancelled" })).toBeNull();
  });

  test("reports a build failure when a deployment with a source has to rebuild", () => {
    const stage = deploymentFailureStage({
      ...base,
      status: "failed",
      sourceDeploymentId: "old",
      commitSha: "abc",
    });

    expect(stage).toBe("Construção da imagem");
  });
});
