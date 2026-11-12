import { expect, test } from "bun:test";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino from "pino";

import { getConfig } from "@/config";
import { type Database, migrateDatabase, openDatabase, openMemoryDatabase } from "@/db";
import { assertJobOwnership, claimNextJob, enqueueJob, recoverExpiredJobs } from "@/jobs";
import { createTestProject, createTestSecretBox } from "@/testing";

import { ServerHosts } from "./servers/server-hosts";
import { Worker } from "./worker";

const POLL_TEST_TIMEOUT_IN_MS = 3000;

async function testWorker(database: Database, logger: pino.Logger): Promise<Worker> {
  const config = {
    ...getConfig(),
    DOCKER_BINARY: "nelcota-test-unavailable-docker",
    BACKUP_DIR: undefined,
  };
  return new Worker({
    workerId: "test",
    database,
    hosts: new ServerHosts(config, "unused-key"),
    secretBox: await createTestSecretBox(),
    config,
    logger,
    offsiteStore: null,
  });
}

async function waitForPoll(promise: Promise<void>): Promise<void> {
  const { promise: deadline, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => reject(new Error("The worker did not report the expected failure")),
    POLL_TEST_TIMEOUT_IN_MS,
  );
  using _timer = { [Symbol.dispose]: () => clearTimeout(timer) };
  await Promise.race([promise, deadline]);
}

test("retries a failed queue poll and leaves a job recoverable after a failed outcome write", async () => {
  const database = openMemoryDatabase();
  using _connection = database.$client;
  const project = createTestProject(database);
  const { id } = enqueueJob(database, {
    kind: "console_command",
    projectId: project.id,
    maxAttempts: 2,
  });
  database.$client.exec(`
    CREATE TRIGGER reject_claim BEFORE UPDATE OF status ON jobs WHEN new.status = 'running'
    BEGIN SELECT RAISE(ABORT, 'claim write unavailable'); END;
    CREATE TRIGGER reject_outcome BEFORE UPDATE OF status ON jobs WHEN new.status = 'failed'
    BEGIN SELECT RAISE(ABORT, 'outcome write unavailable'); END;
  `);
  const failedClaim = Promise.withResolvers<void>();
  const failedOutcome = Promise.withResolvers<void>();
  const logger = pino(
    { level: "error" },
    {
      write: (line: string) => {
        if (line.includes('"duty":"claim jobs"')) {
          failedClaim.resolve();
        }

        if (line.includes('"msg":"could not record job failure"')) {
          failedOutcome.resolve();
        }
      },
    },
  );
  const worker = await testWorker(database, logger);
  const running = worker.run();
  await using _worker = {
    [Symbol.asyncDispose]: async () => {
      worker.stop();
      await running;
    },
  };

  await waitForPoll(failedClaim.promise);
  database.$client.exec("DROP TRIGGER reject_claim");
  await waitForPoll(failedOutcome.promise);
  database.$client.exec("DROP TRIGGER reject_outcome");
  const job = database.$client
    .query<{ lease: string | null }, [string]>(
      "SELECT lease_expires_at AS lease FROM jobs WHERE id = ?",
    )
    .get(id);
  if (job?.lease == null) {
    throw new Error("Expected the failed job to retain its lease");
  }

  const recovered = recoverExpiredJobs(database, new Date(job.lease));

  expect(recovered).toMatchObject([{ id, outcome: "requeued" }]);
});

test("starting another worker with the same ID preserves the active process lease", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nelcota-worker-lease-"));
  const path = join(directory, "queue.sqlite");
  await using _files = {
    async [Symbol.asyncDispose]() {
      for (const file of [path, `${path}-wal`, `${path}-shm`]) {
        await rm(file, { force: true });
      }

      await rmdir(directory);
    },
  };
  const ownerDatabase = openDatabase(path);
  using _owner = ownerDatabase.$client;
  migrateDatabase(ownerDatabase);
  const project = createTestProject(ownerDatabase);
  enqueueJob(ownerDatabase, { kind: "container_action", projectId: project.id, maxAttempts: 2 });
  const claim = claimNextJob(ownerDatabase, "test");
  if (claim == null) {
    throw new Error("Expected the first process to claim the job");
  }

  const nextDatabase = openDatabase(path);
  using _next = nextDatabase.$client;
  const worker = await testWorker(nextDatabase, pino({ level: "silent" }));
  const running = worker.run();
  await using _worker = {
    [Symbol.asyncDispose]: async () => {
      worker.stop();
      await running;
    },
  };

  expect(() => assertJobOwnership(ownerDatabase, claim)).not.toThrow();
});
