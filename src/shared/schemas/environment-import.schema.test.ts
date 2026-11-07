import { describe, expect, test } from "bun:test";

import {
  environmentImportSchema,
  MAX_IMPORT_ENTRIES,
  MAX_IMPORT_TEXT_LENGTH,
  suggestedVariableKind,
} from "./environment-import.schema";

describe("suggestedVariableKind", () => {
  test.each([
    ["NODE_ENV", "production", "plain"],
    ["AUTH_SECRET", "abc", "secret"],
    ["DATABASE_URL", "postgres://database/app", "secret"],
    ["SERVICE_API_KEY", "abc", "secret"],
    ["NELCOTA_ENCRYPTION_KEY", "abc", "secret"],
    ["AWS_ACCESS_KEY_ID", "abc", "secret"],
    ["ENDPOINT", "https://user:password@example.com", "secret"],
    ["TOKENIZER", "custom", "plain"],
  ] as const)("classifies %s as %s", (key, value, kind) => {
    expect(suggestedVariableKind(key, value)).toBe(kind);
  });
});

describe("environmentImportSchema", () => {
  const entry = { key: "MODE", value: "production", expectedUpdatedAt: null };

  test("rejects duplicate variable names", () => {
    expect(
      environmentImportSchema.safeParse({ kind: "automatic", entries: [entry, entry] }).success,
    ).toBe(false);
  });

  test.each([
    { entries: [] },
    { entries: [{ ...entry, key: "PATH" }] },
    { entries: [{ ...entry, value: "bad\0value" }] },
    { entries: [{ ...entry, expectedUpdatedAt: "invalid" }] },
  ])("rejects invalid entries %p", ({ entries }) => {
    expect(environmentImportSchema.safeParse({ kind: "automatic", entries }).success).toBe(false);
  });

  test("rejects oversized batches", () => {
    const entries = Array.from({ length: MAX_IMPORT_ENTRIES + 1 }, (_, index) => ({
      ...entry,
      key: `KEY_${index}`,
    }));

    expect(environmentImportSchema.safeParse({ kind: "automatic", entries }).success).toBe(false);
  });

  test("rejects a batch whose combined text exceeds the limit", () => {
    const valueLength = MAX_IMPORT_TEXT_LENGTH / 8;
    const entries = Array.from({ length: 9 }, (_, index) => ({
      ...entry,
      key: `KEY_${index}`,
      value: "x".repeat(valueLength),
    }));

    expect(environmentImportSchema.safeParse({ kind: "automatic", entries }).success).toBe(false);
  });
});
