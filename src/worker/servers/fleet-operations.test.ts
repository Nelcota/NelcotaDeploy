import { expect, test } from "bun:test";

import { FleetOperations } from "./fleet-operations";

test("bounds fleet work, deduplicates keys and retains ownership until slow operations settle", async () => {
  using operations = new FleetOperations();
  const release = Promise.withResolvers<void>();
  let active = 0;
  let peak = 0;
  let started = 0;
  const run = async () => {
    active += 1;
    started += 1;
    peak = Math.max(peak, active);
    await release.promise;
    active -= 1;
  };
  const first = operations.run("first", run);
  expect(operations.run("first", run)).toBe(first);
  const pending = Array.from({ length: 10 }, (_, index) => operations.run(String(index), run));
  await Promise.resolve();
  expect(started).toBe(4);
  release.resolve();
  await Promise.all([first, ...pending]);
  expect(started).toBe(11);
  expect(peak).toBe(4);
});

test("disposal stops queued work without resolving active operations early", async () => {
  using operations = new FleetOperations();
  const release = Promise.withResolvers<void>();
  let started = 0;
  const pending = Array.from({ length: 8 }, (_, index) =>
    operations.run(String(index), async () => {
      started += 1;
      await release.promise;
    }),
  );
  await Promise.resolve();
  operations[Symbol.dispose]();
  let settled = false;
  const finished = Promise.all(pending).then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  release.resolve();
  await finished;
  expect(started).toBe(4);
  await operations.run("late", () => {
    throw new Error("Disposed work ran");
  });
});
