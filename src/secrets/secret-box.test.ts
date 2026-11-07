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
  test.each([0, 1, 16, 131_073])(
    "preserves the existing binary envelope for %p bytes",
    async (size) => {
      const box = await SecretBox.fromBase64Key(KEY);
      const key = await crypto.subtle.importKey(
        "raw",
        Buffer.from(KEY, "base64"),
        "AES-GCM",
        false,
        ["encrypt", "decrypt"],
      );
      const plaintext = new Uint8Array(size).fill(37);
      const context = "compatible-backup";
      const associatedData = new TextEncoder().encode(context);
      const iv = new Uint8Array(12).fill(9);
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: associatedData },
        key,
        plaintext,
      );
      const legacy = new Uint8Array(16 + ciphertext.byteLength);
      legacy.set(new TextEncoder().encode("NLC1"));
      legacy.set(iv, 4);
      legacy.set(new Uint8Array(ciphertext), 16);
      expect(await box.decryptBytes(legacy, context)).toEqual(plaintext);
      const current = await box.encryptBytes(plaintext, context);
      const restored = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: current.subarray(4, 16), additionalData: associatedData },
        key,
        current.subarray(16),
      );
      expect(new Uint8Array(restored)).toEqual(plaintext);
      expect(current.byteLength).toBe(plaintext.byteLength + 32);
    },
  );

  test.each([4, 16, 32])(
    "rejects a modified IV, ciphertext or tag at byte %p",
    async (position) => {
      const box = await SecretBox.fromBase64Key(KEY);
      const encrypted = await box.encryptBytes(new Uint8Array([1, 2, 3, 4]), "authenticated");
      const value = encrypted.at(position);
      if (value == null) {
        throw new Error("Missing encrypted fixture byte");
      }
      const changed = encrypted.with(position, value ^ 1);
      const failure: unknown = await box
        .decryptBytes(changed, "authenticated")
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SecretDecryptionError);
    },
  );

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

  test("redacts short credentials and ignores only empty values", () => {
    const redact = createRedactor(["a", ""]);

    expect(redact("a cat")).toBe("[REDACTED] c[REDACTED]t");
    expect(createRedactor([""])("a cat")).toBe("a cat");
  });
});
