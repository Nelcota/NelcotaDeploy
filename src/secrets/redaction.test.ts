import { expect, test } from "bun:test";

import { createRedactor } from "./redaction";

test.each(["\n", "\r\n", "\r"])(
  "redacts every line of a multiline secret separated by %p",
  (separator) => {
    const redact = createRedactor([`private-first-line${separator}private-second-line`]);

    expect(redact("key=private-first-line")).toBe("key=[REDACTED]");
    expect(redact("private-second-line")).toBe("[REDACTED]");
  },
);

test("redacts short credentials instead of silently excluding them", () => {
  const redact = createRedactor(["xyz"]);

  expect(redact("password=xyz")).toBe("password=[REDACTED]");
});

test("keeps ordinary output unchanged when no nonempty secrets exist", () => {
  expect(createRedactor([""])("application ready")).toBe("application ready");
});

test("normalizes terminal escapes before hiding secrets", () => {
  const redact = createRedactor(["private-password"]);
  expect(redact("private-\u001b[31mpassword\u001b[0m")).toBe("[REDACTED]");
});

test("hides encoded and decoded credentials from a secret connection URL", () => {
  const redact = createRedactor(["postgresql://app:p%40ssword@database:5432/app"]);
  expect(redact("password=p@ssword encoded=p%40ssword")).toBe(
    "password=[REDACTED] encoded=[REDACTED]",
  );
});

test("accepts a URL password with an invalid percent escape", () => {
  expect(createRedactor(["redis://default:p%xx@database"])("p%xx")).toBe("[REDACTED]");
});
