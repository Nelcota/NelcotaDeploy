import { describe, expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { listDeployments } from "@/deployments";
import { createTestProject } from "@/testing";

import { handleGitHubDelivery } from "./github-webhook.service";
import { InvalidWebhookSignatureError } from "./webhook.errors";

const SECRET = "webhook-test-secret";
const SHA = "0123456789abcdef0123456789abcdef01234567";

function sign(body: string, secret = SECRET): string {
  return `sha256=${new Bun.CryptoHasher("sha256", secret).update(body).digest("hex")}`;
}

function pushBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ref: "refs/heads/main",
    after: SHA,
    repository: { full_name: "Acme/API" },
    head_commit: { message: "fix: something\n\nbody" },
    pusher: { name: "octocat" },
    ...overrides,
  });
}

function delivery(
  body: string,
  overrides: Partial<{ deliveryId: string; event: string; signature: string | null }> = {},
) {
  return {
    deliveryId: "delivery-1",
    event: "push",
    signature: sign(body),
    rawBody: body,
    ...overrides,
  };
}

describe("handleGitHubDelivery signature checks", () => {
  test("throws InvalidWebhookSignatureError for a wrong signature", async () => {
    const database = openMemoryDatabase();
    const body = pushBody();

    const result = handleGitHubDelivery(
      database,
      delivery(body, { signature: sign(body, "other") }),
      SECRET,
    );

    expect(await result.catch((error: unknown) => error)).toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
  });

  test("throws InvalidWebhookSignatureError when the signature is missing", async () => {
    const database = openMemoryDatabase();

    const result = handleGitHubDelivery(
      database,
      delivery(pushBody(), { signature: null }),
      SECRET,
    );

    expect(await result.catch((error: unknown) => error)).toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
  });

  test("throws InvalidWebhookSignatureError when the body was changed after signing", async () => {
    const database = openMemoryDatabase();
    const body = pushBody();

    const result = handleGitHubDelivery(
      database,
      { ...delivery(body), rawBody: `${body} ` },
      SECRET,
    );

    expect(await result.catch((error: unknown) => error)).toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
  });
});

describe("handleGitHubDelivery push events", () => {
  test("queues a deployment of the exact pushed commit", async () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    const outcome = await handleGitHubDelivery(database, delivery(pushBody()), SECRET);

    expect(outcome.status).toBe("accepted");
    const [deployment] = listDeployments(database, { projectId: project.id, limit: 10 });
    expect(deployment?.requestedCommitSha).toBe(SHA);
    expect(deployment?.trigger).toBe("webhook");
    expect(deployment?.commitMessage).toBe("fix: something");
  });

  test("processes a redelivered delivery id only once", async () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    await handleGitHubDelivery(database, delivery(pushBody()), SECRET);

    const second = await handleGitHubDelivery(database, delivery(pushBody()), SECRET);

    expect(second.status).toBe("duplicate");
    expect(listDeployments(database, { projectId: project.id, limit: 10 })).toHaveLength(1);
  });
});

describe("handleGitHubDelivery ignored events", () => {
  test("ignores pushes to another branch and records the delivery", async () => {
    const database = openMemoryDatabase();
    createTestProject(database);

    const outcome = await handleGitHubDelivery(
      database,
      delivery(pushBody({ ref: "refs/heads/develop" })),
      SECRET,
    );

    expect(outcome.status).toBe("ignored");
    expect(
      database.select({ id: tables.webhookDeliveries.id }).from(tables.webhookDeliveries).all(),
    ).toHaveLength(1);
  });

  test("ignores projects with auto-deploy disabled", async () => {
    const database = openMemoryDatabase();
    createTestProject(database, { autoDeploy: false });

    const outcome = await handleGitHubDelivery(database, delivery(pushBody()), SECRET);

    expect(outcome.status).toBe("ignored");
  });

  test("ignores branch deletions", async () => {
    const database = openMemoryDatabase();
    createTestProject(database);

    const outcome = await handleGitHubDelivery(
      database,
      delivery(pushBody({ deleted: true, after: "0".repeat(40) })),
      SECRET,
    );

    expect(outcome.status).toBe("ignored");
  });

  test("acknowledges ping events", async () => {
    const database = openMemoryDatabase();
    const body = JSON.stringify({ zen: "Keep it simple" });

    const outcome = await handleGitHubDelivery(database, delivery(body, { event: "ping" }), SECRET);

    expect(outcome).toEqual({ status: "ignored", reason: "ping" });
  });
});
