import { expect, test } from "bun:test";

import { MAX_IMPORT_TEXT_LENGTH } from "@/shared/schemas/environment/environment-import.schema";

import { readEnvImportFile } from "./env-import-file";

test("reads UTF-8 locally without evaluating values", async () => {
  const text = 'APP_NAME="Aplicação"\nVALUE=$(never-run)';

  expect(await readEnvImportFile(new File([text], ".env"))).toBe(text);
});

test("accepts the maximum file size", async () => {
  const text = "A".repeat(MAX_IMPORT_TEXT_LENGTH);

  expect((await readEnvImportFile(new File([text], ".env"))).length).toBe(MAX_IMPORT_TEXT_LENGTH);
});

test.each(["", "x".repeat(MAX_IMPORT_TEXT_LENGTH + 1)])(
  "rejects an empty or oversized file",
  async (text) => {
    const error: unknown = await readEnvImportFile(new File([text], ".env")).catch(
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(RangeError);
  },
);

test.each([new Uint8Array([0xff]), new Uint8Array([65, 0, 66]), new Uint8Array([32, 10, 32])])(
  "rejects invalid UTF-8, binary or whitespace-only content",
  async (bytes) => {
    const error: unknown = await readEnvImportFile(new File([bytes], ".env")).catch(
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(TypeError);
  },
);
