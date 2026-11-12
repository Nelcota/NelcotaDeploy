import { expect, test } from "bun:test";

import { openMemoryDatabase, tables } from "@/db";
import { GitHubApiError, type GitHubPullRequest } from "@/github";
import { listActivePreviews } from "@/previews";
import { saveSystemSettings } from "@/settings";
import { DEFAULT_SYSTEM_SETTINGS } from "@/shared/schemas/settings.schema";
import { createTestProject, createTestSecretBox } from "@/testing";

import { handleGitHubDelivery } from "./github-webhook.service";
import { reconcilePullRequests } from "./pull-request-reconciliation";

const SECRET = "test-webhook-reconciliation-secret";
const NUMBER = 17;
const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);

function snapshot(state: "open" | "closed", sha = OLD_SHA): GitHubPullRequest {
  return {
    state,
    title: "Preview reconciliation",
    head: { sha, ref: "feature", repo: { full_name: "acme/api" } },
    base: { ref: "main", repo: { full_name: "acme/api" } },
  };
}

async function fixture() {
  const database = openMemoryDatabase();
  const project = createTestProject(database, { previewsEnabled: true });
  saveSystemSettings(database, { ...DEFAULT_SYSTEM_SETTINGS, baseDomain: "apps.example.com" });
  const secretBox = await createTestSecretBox();
  const accept = async (deliveryId: string, action: string) => {
    const rawBody = JSON.stringify({ action, number: NUMBER, pull_request: snapshot("open") });
    const signature = `sha256=${new Bun.CryptoHasher("sha256", SECRET).update(rawBody).digest("hex")}`;
    return await handleGitHubDelivery(
      database,
      { deliveryId, event: "pull_request", signature, rawBody },
      [SECRET],
    );
  };
  const active = () => listActivePreviews(database, project.id);
  const reconcile = async (state: GitHubPullRequest) =>
    await reconcilePullRequests(database, secretBox, {
      readSnapshot: async () => await Promise.resolve(state),
    });
  return { database, secretBox, accept, active, reconcile };
}

test("a late synchronize keeps the preview closed when GitHub reports it closed", async () => {
  const { database, accept, active, reconcile } = await fixture();
  using _connection = database.$client;
  expect(await accept("open-1", "opened")).toEqual({ status: "accepted", deploymentIds: [] });
  expect(active()).toEqual([]);
  await reconcile(snapshot("open"));
  expect(active()).toHaveLength(1);

  await accept("close-1", "closed");
  await accept("late-sync", "synchronize");
  await reconcile(snapshot("closed"));

  expect(active()).toEqual([]);
  expect(database.select().from(tables.deployments).all()).toHaveLength(1);
});

test("a stale response cannot apply after a newer delivery changes the generation", async () => {
  const { database, secretBox, accept, active, reconcile } = await fixture();
  using _connection = database.$client;
  const reading = Promise.withResolvers<void>();
  const stale = Promise.withResolvers<GitHubPullRequest>();
  await accept("initial", "opened");
  const previous = reconcilePullRequests(database, secretBox, {
    readSnapshot: () => {
      reading.resolve();
      return stale.promise;
    },
  });
  await reading.promise;
  await accept("newer", "synchronize");
  await reconcile(snapshot("open", NEW_SHA));
  stale.resolve(snapshot("open"));
  await previous;

  expect(active().map((preview) => preview.headSha)).toEqual([NEW_SHA]);
  expect(database.select().from(tables.deployments).all()).toHaveLength(1);
});

test("a real reopen can deploy the same commit again", async () => {
  const { database, accept, active, reconcile } = await fixture();
  using _connection = database.$client;
  await accept("opened", "opened");
  await reconcile(snapshot("open"));
  await accept("closed", "closed");
  await reconcile(snapshot("closed"));

  await accept("reopened", "reopened");
  await reconcile(snapshot("open"));

  expect(active().map((preview) => preview.headSha)).toEqual([OLD_SHA]);
  expect(database.select().from(tables.deployments).all()).toHaveLength(2);
});

test("a new head requests cancellation of the earlier preview deployment", async () => {
  const { database, accept, reconcile } = await fixture();
  using _connection = database.$client;
  await accept("first-head", "opened");
  await reconcile(snapshot("open"));

  await accept("updated-head", "synchronize");
  await reconcile(snapshot("open", NEW_SHA));

  const deployments = database.select().from(tables.deployments).all();
  expect(
    deployments.find((deployment) => deployment.requestedCommitSha === OLD_SHA)?.cancelRequestedAt,
  ).toBeString();
  expect(
    deployments.find((deployment) => deployment.requestedCommitSha === NEW_SHA)?.cancelRequestedAt,
  ).toBeNull();
});

test("persists a retry when GitHub is unavailable and applies its later snapshot", async () => {
  const { database, secretBox, accept, active } = await fixture();
  using _connection = database.$client;
  await accept("opened", "opened");
  const now = new Date();
  await reconcilePullRequests(database, secretBox, {
    now,
    readSnapshot: async () => await Promise.reject(new GitHubApiError("GitHub rate limit", 429)),
  });
  const pending = database.select().from(tables.pullRequestReconciliations).get();

  expect(pending?.attempts).toBe(1);
  expect(active()).toEqual([]);
  expect(pending?.nextAttemptAt).toBe(new Date(now.getTime() + 30_000).toISOString());
  await reconcilePullRequests(database, secretBox, {
    now: new Date(now.getTime() + 30_000),
    readSnapshot: async () => await Promise.resolve(snapshot("open")),
  });

  expect(active()).toHaveLength(1);
  const completed = database.select().from(tables.pullRequestReconciliations).get();
  expect(completed?.attempts).toBe(0);
  expect(completed?.observedState).toBe("open");
});

test("rechecks an active preview when GitHub never delivered the closure", async () => {
  const { database, secretBox, accept, active, reconcile } = await fixture();
  using _connection = database.$client;
  await accept("opened", "opened");
  await reconcile(snapshot("open"));
  const nextCheck = database.select().from(tables.pullRequestReconciliations).get()?.nextAttemptAt;
  if (nextCheck == null) {
    throw new Error("Expected the preview to have a scheduled recheck");
  }

  await reconcilePullRequests(database, secretBox, {
    now: new Date(nextCheck),
    readSnapshot: async () => await Promise.resolve(snapshot("closed")),
  });

  expect(active()).toEqual([]);
  expect(database.select().from(tables.pullRequestReconciliations).get()?.nextAttemptAt).toBeNull();
  const receipt = database.select().from(tables.webhookDeliveries).get();
  expect(receipt?.status).toBe("accepted");
  expect(receipt?.deploymentIds).toHaveLength(1);
});

test("claims one reconciliation for a duplicate delivery", async () => {
  const { database, accept, reconcile } = await fixture();
  using _connection = database.$client;
  await accept("duplicate", "opened");

  expect(await accept("duplicate", "opened")).toEqual({ status: "duplicate" });
  await reconcile(snapshot("open"));

  expect(database.select().from(tables.deployments).all()).toHaveLength(1);
});
