import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDatabase, openDatabase, openMemoryDatabase, tables } from "@/db";
import { listDeployments } from "@/deployments";
import { createTestProject } from "@/testing";

import { handleGitHubDelivery, listWebhookDeliveries } from "./github-webhook.service";
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
  test("rolls back failed deliveries and retries every project on redelivery", async () => {
    const database = openMemoryDatabase();
    createTestProject(database);
    createTestProject(database, { name: "Other", slug: "other" });
    database.$client.run(
      "CREATE TEMP TRIGGER fail_second BEFORE INSERT ON deployments WHEN (SELECT COUNT(*) FROM deployments) >= 1 BEGIN SELECT RAISE(ABORT, 'Transient failure'); END",
    );
    const request = delivery(pushBody());

    const error = await handleGitHubDelivery(database, request, [SECRET]).catch(
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject({ message: "Transient failure" });

    expect(
      database.select({ id: tables.deployments.id }).from(tables.deployments).all(),
    ).toHaveLength(0);
    expect(
      database.select({ id: tables.webhookDeliveries.id }).from(tables.webhookDeliveries).all(),
    ).toHaveLength(0);
    database.$client.run("DROP TRIGGER fail_second");
    const retried = await handleGitHubDelivery(database, request, [SECRET]);
    expect(retried.status).toBe("accepted");
    expect(
      database.select({ id: tables.deployments.id }).from(tables.deployments).all(),
    ).toHaveLength(2);
    expect(await handleGitHubDelivery(database, request, [SECRET])).toEqual({
      status: "duplicate",
    });
    database.$client.close();
  });
  test("throws InvalidWebhookSignatureError for a wrong signature", async () => {
    const database = openMemoryDatabase();
    const body = pushBody();

    const result = handleGitHubDelivery(
      database,
      delivery(body, { signature: sign(body, "other") }),
      [SECRET],
    );

    expect(await result.catch((error: unknown) => error)).toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
  });
});

describe("handleGitHubDelivery with several secrets", () => {
  test("accepts a delivery signed with any of the secrets", async () => {
    const database = openMemoryDatabase();
    const body = pushBody();

    const outcome = await handleGitHubDelivery(
      database,
      delivery(body, { signature: sign(body, "app-secret") }),
      [SECRET, "app-secret"],
    );

    expect(outcome.status).not.toBe("duplicate");
  });

  test("throws InvalidWebhookSignatureError when no secret is accepted", async () => {
    const database = openMemoryDatabase();
    const body = pushBody();

    const result = handleGitHubDelivery(database, delivery(body), []);

    expect(await result.catch((error: unknown) => error)).toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
  });
});

describe("handleGitHubDelivery without a signature", () => {
  test("throws InvalidWebhookSignatureError when the signature is missing", async () => {
    const database = openMemoryDatabase();

    const result = handleGitHubDelivery(database, delivery(pushBody(), { signature: null }), [
      SECRET,
    ]);

    expect(await result.catch((error: unknown) => error)).toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
  });

  test("throws InvalidWebhookSignatureError when the body was changed after signing", async () => {
    const database = openMemoryDatabase();
    const body = pushBody();

    const result = handleGitHubDelivery(database, { ...delivery(body), rawBody: `${body} ` }, [
      SECRET,
    ]);

    expect(await result.catch((error: unknown) => error)).toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
  });
});

describe("handleGitHubDelivery push events", () => {
  test("queues a deployment of the exact pushed commit", async () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);

    const outcome = await handleGitHubDelivery(database, delivery(pushBody()), [SECRET]);

    expect(outcome.status).toBe("accepted");
    const [deployment] = listDeployments(database, { projectId: project.id, limit: 10 });
    expect(deployment?.requestedCommitSha).toBe(SHA);
    expect(deployment?.trigger).toBe("webhook");
    expect(deployment?.commitMessage).toBe("fix: something");
  });

  test("processes a redelivered delivery id only once", async () => {
    const database = openMemoryDatabase();
    const project = createTestProject(database);
    await handleGitHubDelivery(database, delivery(pushBody()), [SECRET]);

    const second = await handleGitHubDelivery(database, delivery(pushBody()), [SECRET]);

    expect(second.status).toBe("duplicate");
    expect(listDeployments(database, { projectId: project.id, limit: 10 })).toHaveLength(1);
  });

  test("claims a concurrent delivery once across two database connections", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nelcota-webhook-claim-"));
    const path = join(directory, "delivery.db");
    await using _files = {
      async [Symbol.asyncDispose]() {
        await Promise.all(
          [path, `${path}-wal`, `${path}-shm`].map(async (file) => await rm(file, { force: true })),
        );
        await rmdir(directory);
      },
    };
    const database = openDatabase(path);
    using _connection = database.$client;
    migrateDatabase(database);
    const contender = openDatabase(path);
    using _contender = contender.$client;
    const project = createTestProject(database);
    const request = delivery(pushBody());

    const outcomes = await Promise.all([
      handleGitHubDelivery(database, request, [SECRET]),
      handleGitHubDelivery(contender, request, [SECRET]),
    ]);

    expect(outcomes.map(({ status }) => status).toSorted()).toEqual(["accepted", "duplicate"]);
    expect(listDeployments(database, { projectId: project.id, limit: 10 })).toHaveLength(1);
    expect(listWebhookDeliveries(database, 10)).toHaveLength(1);
  });
});

test("bounds the delivery page size for non-finite limits", () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const maxPage = 100;
  database
    .insert(tables.webhookDeliveries)
    .values(
      Array.from({ length: maxPage + 1 }, (_, index) => ({
        id: `delivery-${index}`,
        event: "ping",
        status: "ignored" as const,
        reason: "ping",
        deploymentIds: [],
        receivedAt: "2026-11-12T00:00:00Z",
      })),
    )
    .run();

  expect(listWebhookDeliveries(database, Number.NaN)).toHaveLength(1);
  expect(listWebhookDeliveries(database, Number.NEGATIVE_INFINITY)).toHaveLength(1);
  expect(listWebhookDeliveries(database, Number.POSITIVE_INFINITY)).toHaveLength(maxPage);
});

describe("handleGitHubDelivery ignored events", () => {
  test("ignores pushes to another branch and records the delivery", async () => {
    const database = openMemoryDatabase();
    createTestProject(database);

    const outcome = await handleGitHubDelivery(
      database,
      delivery(pushBody({ ref: "refs/heads/develop" })),
      [SECRET],
    );

    expect(outcome.status).toBe("ignored");
    expect(
      database.select({ id: tables.webhookDeliveries.id }).from(tables.webhookDeliveries).all(),
    ).toHaveLength(1);
  });

  test("ignores projects with auto-deploy disabled", async () => {
    const database = openMemoryDatabase();
    createTestProject(database, { autoDeploy: false });

    const outcome = await handleGitHubDelivery(database, delivery(pushBody()), [SECRET]);

    expect(outcome.status).toBe("ignored");
  });

  test("ignores branch deletions", async () => {
    const database = openMemoryDatabase();
    createTestProject(database);

    const outcome = await handleGitHubDelivery(
      database,
      delivery(pushBody({ deleted: true, after: "0".repeat(40) })),
      [SECRET],
    );

    expect(outcome.status).toBe("ignored");
  });

  test("acknowledges ping events", async () => {
    const database = openMemoryDatabase();
    const body = JSON.stringify({ zen: "Keep it simple" });

    const outcome = await handleGitHubDelivery(database, delivery(body, { event: "ping" }), [
      SECRET,
    ]);

    expect(outcome).toEqual({ status: "ignored", reason: "ping" });
  });
});
