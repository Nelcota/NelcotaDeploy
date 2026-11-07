import { describe, expect, test } from "bun:test";

import {
  appendLogLine,
  type LogLine,
  logEndEventSchema,
  logLineEventSchema,
} from "@/web/components/monitoring/log-stream";

describe("appendLogLine", () => {
  test("adds the line at the end while under the limit", () => {
    const lines = appendLogLine(["a", "b"], "c", 3);

    expect(lines).toEqual(["a", "b", "c"]);
  });

  test("drops the oldest line when the limit is reached", () => {
    const lines = appendLogLine(["a", "b", "c"], "d", 3);

    expect(lines).toEqual(["b", "c", "d"]);
  });

  test("keeps only the new line with a limit of one", () => {
    const lines = appendLogLine(["a"], "b", 1);

    expect(lines).toEqual(["b"]);
  });

  test("throws RangeError when the limit is zero", () => {
    expect(() => appendLogLine([], "a", 0)).toThrow(RangeError);
  });

  test("throws RangeError when the limit is not an integer", () => {
    expect(() => appendLogLine([], "a", Number.NaN)).toThrow(RangeError);
  });
});

const LINE = {
  id: 1,
  message: "Application started",
  stream: "stdout",
  createdAt: "2026-11-06T12:00:00.123456789Z",
} satisfies LogLine;

describe("logLineEventSchema", () => {
  test.each(["system", "stdout", "stderr"])(
    "accepts a %s line and strips unrelated metadata",
    (stream) => {
      expect(
        logLineEventSchema.parse(
          JSON.stringify({ ...LINE, stream, deploymentId: "deployment-one" }),
        ),
      ).toEqual({ ...LINE, stream });
    },
  );

  test.each(["info", "warn", "error"])("accepts the %s severity", (level) => {
    expect(logLineEventSchema.parse(JSON.stringify({ ...LINE, level }))).toEqual({
      ...LINE,
      level,
    });
  });

  test("preserves blank lines and the server's largest truncated line", () => {
    expect(logLineEventSchema.parse(JSON.stringify({ ...LINE, message: "" })).message).toBe("");
    const message = `${"a".repeat(8192)}…`;
    expect(logLineEventSchema.parse(JSON.stringify({ ...LINE, message })).message).toBe(message);
  });

  test.each([
    { id: 0 },
    { id: -1 },
    { id: 1.5 },
    { id: Number.MAX_SAFE_INTEGER + 1 },
    { id: "1" },
    { message: null },
    { message: 123 },
    { message: {} },
    { message: "a".repeat(8194) },
    { createdAt: "" },
    { createdAt: "not-a-date" },
    { createdAt: "2026-11-06T12:00:00" },
    { createdAt: "2026-11-06T12:00:00+02:00" },
    { stream: "" },
    { stream: "unknown" },
    { level: null },
    { level: "debug" },
  ])("rejects an invalid field: %#", (fields) => {
    expect(logLineEventSchema.safeParse(JSON.stringify({ ...LINE, ...fields })).success).toBe(
      false,
    );
  });

  test.each([
    undefined,
    null,
    1,
    "",
    "  ",
    "{",
    "null",
    "[]",
    "{}",
    '{"id":1e309}',
    " ".repeat(10) + "x".repeat(65_537),
  ])("rejects malformed or incomplete events: %#", (value) => {
    expect(logLineEventSchema.safeParse(value).success).toBe(false);
  });

  test("rejects a missing required field without inventing defaults", () => {
    const { message, ...withoutMessage } = LINE;
    expect(message).toBe("Application started");
    expect(logLineEventSchema.safeParse(JSON.stringify(withoutMessage)).success).toBe(false);
  });
});

describe("logEndEventSchema", () => {
  test.each(["succeeded", "failed", "cancelled"])("accepts a %s terminal status", (status) => {
    expect(logEndEventSchema.parse(JSON.stringify({ status }))).toEqual({ status });
  });

  test("accepts a stream without a deployment summary", () => {
    expect(logEndEventSchema.parse("{}")).toEqual({});
  });

  test.each([
    "",
    " ",
    "{",
    "null",
    "[]",
    "false",
    "123",
    '{"status":null}',
    '{"status":"building"}',
    '{"status":"unknown"}',
  ])("rejects an invalid end event: %s", (text) => {
    expect(logEndEventSchema.safeParse(text).success).toBe(false);
  });
});
