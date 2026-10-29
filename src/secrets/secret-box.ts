import { requireConfigValue } from "@/config";

import { InvalidEncryptionKeyError, SecretDecryptionError } from "./secrets.errors";

const FORMAT_VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const encoder = new TextEncoder();
/** Marks binary payloads of {@link SecretBox.encryptBytes}, so other files are never mistaken for one. */
const BYTES_MAGIC = encoder.encode("NLC1");
const decoder = new TextDecoder();

/**
 * Encrypts and decrypts short secrets with AES-256-GCM.
 *
 * @remarks
 * Output format: `v1:<base64 iv>:<base64 ciphertext+tag>`. The associated data binds a
 * ciphertext to where it is stored (for example a variable name), so copying it to
 * another row fails authentication.
 */
export class SecretBox {
  readonly #key: CryptoKey;

  private constructor(key: CryptoKey) {
    this.#key = key;
  }

  /**
   * Imports a 32-byte base64 key.
   *
   * @param base64Key - Key from configuration, never from the database.
   * @returns A ready-to-use box.
   * @throws {InvalidEncryptionKeyError} When the key is not exactly 32 bytes.
   */
  static async fromBase64Key(base64Key: string): Promise<SecretBox> {
    const rawKey = Buffer.from(base64Key, "base64");
    if (rawKey.byteLength !== KEY_BYTES) {
      throw new InvalidEncryptionKeyError(
        `Encryption key must be ${KEY_BYTES} bytes, got ${rawKey.byteLength}`,
      );
    }
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    return new SecretBox(key);
  }

  /**
   * Encrypts a value.
   *
   * @param plaintext - Secret value.
   * @param associatedData - Context the ciphertext is bound to.
   * @returns The encoded ciphertext.
   */
  async encrypt(plaintext: string, associatedData: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(associatedData) },
      this.#key,
      encoder.encode(plaintext),
    );
    return [
      FORMAT_VERSION,
      Buffer.from(iv).toString("base64"),
      Buffer.from(ciphertext).toString("base64"),
    ].join(":");
  }

  /**
   * Decrypts a value produced by {@link SecretBox.encrypt}.
   *
   * @param payload - Encoded ciphertext.
   * @param associatedData - The same context used to encrypt.
   * @returns The plaintext.
   * @throws {SecretDecryptionError} When the payload is malformed, tampered with, or the
   * key or associated data differ.
   */
  async decrypt(payload: string, associatedData: string): Promise<string> {
    const [version, ivText, ciphertextText, ...rest] = payload.split(":");
    if (version !== FORMAT_VERSION || ivText == null || ciphertextText == null || rest.length > 0) {
      throw new SecretDecryptionError("Encrypted value has an unknown format");
    }
    const iv = Buffer.from(ivText, "base64");
    if (iv.byteLength !== IV_BYTES) {
      throw new SecretDecryptionError("Encrypted value has an invalid IV");
    }
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: encoder.encode(associatedData) },
        this.#key,
        Buffer.from(ciphertextText, "base64"),
      );
      return decoder.decode(plaintext);
    } catch (error) {
      throw new SecretDecryptionError(
        `Encrypted value failed authentication: ${error instanceof Error ? error.name : "unknown"}`,
      );
    }
  }

  /**
   * Encrypts a file's contents, such as a database backup.
   *
   * @remarks
   * Output: the bytes `NLC1`, a 12-byte IV, then the ciphertext with its tag.
   *
   * @param plaintext - Bytes to encrypt.
   * @param associatedData - Context the ciphertext is bound to, such as the file name.
   * @returns The encrypted bytes.
   */
  async encryptBytes(
    plaintext: Uint8Array<ArrayBuffer>,
    associatedData: string,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(associatedData) },
      this.#key,
      plaintext,
    );
    const output = new Uint8Array(BYTES_MAGIC.byteLength + IV_BYTES + ciphertext.byteLength);
    output.set(BYTES_MAGIC, 0);
    output.set(iv, BYTES_MAGIC.byteLength);
    output.set(new Uint8Array(ciphertext), BYTES_MAGIC.byteLength + IV_BYTES);
    return output;
  }

  /**
   * Decrypts bytes produced by {@link SecretBox.encryptBytes}.
   *
   * @param payload - Encrypted bytes.
   * @param associatedData - The same context used to encrypt.
   * @returns The original bytes.
   * @throws {SecretDecryptionError} When the payload is not in this format, was tampered with,
   *   or the key or associated data differ.
   */
  async decryptBytes(
    payload: Uint8Array<ArrayBuffer>,
    associatedData: string,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const headerLength = BYTES_MAGIC.byteLength + IV_BYTES;
    const magic = payload.subarray(0, BYTES_MAGIC.byteLength);
    if (payload.byteLength <= headerLength || Buffer.compare(magic, BYTES_MAGIC) !== 0) {
      throw new SecretDecryptionError("Encrypted file has an unknown format");
    }
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: payload.subarray(BYTES_MAGIC.byteLength, headerLength),
          additionalData: encoder.encode(associatedData),
        },
        this.#key,
        payload.subarray(headerLength),
      );
      return new Uint8Array(plaintext);
    } catch (error) {
      throw new SecretDecryptionError(
        `Encrypted file failed authentication: ${error instanceof Error ? error.name : "unknown"}`,
      );
    }
  }
}

let sharedSecretBox: Promise<SecretBox> | undefined;

/**
 * Returns the process-wide box keyed by `NELCOTA_ENCRYPTION_KEY`.
 *
 * @returns The shared box.
 * @throws {InvalidConfigError} When the key is not configured.
 */
export async function getSecretBox(): Promise<SecretBox> {
  sharedSecretBox ??= SecretBox.fromBase64Key(requireConfigValue("NELCOTA_ENCRYPTION_KEY"));
  return await sharedSecretBox;
}
