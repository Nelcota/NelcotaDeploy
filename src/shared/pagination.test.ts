import { expect, test } from "bun:test";

import { pageCursorSchema } from "./pagination";

test("accepts a complete UTC pagination cursor", () => {
  const cursor = { createdAt: "2026-11-01T12:00:00.000Z", id: "deployment" };
  expect(pageCursorSchema.parse(cursor)).toEqual(cursor);
});

test.each([
  null,
  {},
  { createdAt: "2026-11-01T12:00:00Z" },
  { createdAt: "invalid", id: "deployment" },
  { createdAt: "2026-11-01T12:00:00Z", id: " " },
  { createdAt: "2026-11-01T12:00:00Z", id: "x".repeat(129) },
])("rejects an incomplete or malformed pagination cursor: %p", (cursor) => {
  expect(pageCursorSchema.safeParse(cursor).success).toBe(false);
});
