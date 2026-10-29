import { describe, expect, test } from "bun:test";

import { createRedactor } from "./redaction";
import { SecretBox } from "./secret-box";
import { InvalidEncryptionKeyError, SecretDecryptionError } from "./secrets.errors";

const KEY = Buffer.alloc(32, 1).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 2).toString("base64");

describe("SecretBox round trip", () => {
  test("decrypts what it encrypted with the same context", async () => {
    const box = await SecretBox.fromBase64Key(KEY);

    const ciphertext = await box.encrypt("s3cr3t-value", "env:1:API_KEY");

    expect(ciphertext).not.toContain("s3cr3t-value");
    expect(await box.decrypt(ciphertext, "env:1:API_KEY")).toBe("s3cr3t-value");
  });

  test("produces a different ciphertext each time", async () => {
    const box = await SecretBox.fromBase64Key(KEY);

    const first = await box.encrypt("value", "ctx");
    const second = await box.encrypt("value", "ctx");

    expect(first).not.toBe(second);
  });
});

describe("SecretBox rejections", () => {
  test("throws SecretDecryptionError when the context differs", async () => {
    const box = await SecretBox.fromBase64Key(KEY);
    const ciphertext = await box.encrypt("value", "env:1:A");

    const decrypt = box.decrypt(ciphertext, "env:1:B");

    expect(await decrypt.catch((error: unknown) => error)).toBeInstanceOf(SecretDecryptionError);
  });

  test("throws SecretDecryptionError with another key", async () => {
    const ciphertext = await (await SecretBox.fromBase64Key(KEY)).encrypt("value", "ctx");
    const other = await SecretBox.fromBase64Key(OTHER_KEY);

    expect(await other.decrypt(ciphertext, "ctx").catch((error: unknown) => error)).toBeInstanceOf(
      SecretDecryptionError,
    );
  });

  test("throws SecretDecryptionError when the ciphertext was tampered with", async () => {
    const box = await SecretBox.fromBase64Key(KEY);
    const ciphertext = await box.encrypt("value", "ctx");
    const tampered = `${ciphertext.slice(0, -4)}AAAA`;

    expect(await box.decrypt(tampered, "ctx").catch((error: unknown) => error)).toBeInstanceOf(
      SecretDecryptionError,
    );
  });

  test("throws SecretDecryptionError for an unknown format", async () => {
    const box = await SecretBox.fromBase64Key(KEY);

    expect(await box.decrypt("plaintext", "ctx").catch((error: unknown) => error)).toBeInstanceOf(
      SecretDecryptionError,
    );
  });

  test("throws InvalidEncryptionKeyError for a short key", async () => {
    expect(
      await SecretBox.fromBase64Key(Buffer.alloc(16).toString("base64")).catch(
        (error: unknown) => error,
      ),
    ).toBeInstanceOf(InvalidEncryptionKeyError);
  });
});

describe("SecretBox bytes", () => {
  test("decrypts the bytes it encrypted with the same context", async () => {
    const box = await SecretBox.fromBase64Key(KEY);
    const original = Uint8Array.from([0, 1, 2, 250, 255]);

    const encrypted = await box.encryptBytes(original, "nelcota-1.db");

    expect(await box.decryptBytes(encrypted, "nelcota-1.db")).toEqual(original);
  });

  test("throws SecretDecryptionError when the file name differs", async () => {
    const box = await SecretBox.fromBase64Key(KEY);
    const encrypted = await box.encryptBytes(Uint8Array.from([1, 2, 3]), "nelcota-1.db");

    const result = box.decryptBytes(encrypted, "nelcota-2.db");

    expect(await result.catch((error: unknown) => error)).toBeInstanceOf(SecretDecryptionError);
  });

  test("throws SecretDecryptionError for a file that was not encrypted by it", async () => {
    const box = await SecretBox.fromBase64Key(KEY);

    const result = box.decryptBytes(new TextEncoder().encode("SQLite format 3"), "x");

    expect(await result.catch((error: unknown) => error)).toBeInstanceOf(SecretDecryptionError);
  });
});

describe("createRedactor", () => {
  test("replaces every known secret, longest first", () => {
    const redact = createRedactor(["abcd", "abcdef"]);

    expect(redact("token=abcdef and abcd")).toBe("token=[REDACTED] and [REDACTED]");
  });

  test("ignores values too short to redact safely", () => {
    const redact = createRedactor(["a", ""]);

    expect(redact("a cat")).toBe("a cat");
  });
});
