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
