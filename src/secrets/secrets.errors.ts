/** Thrown when a key is malformed. */
export class InvalidEncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEncryptionKeyError";
  }
}

/** Thrown when a ciphertext is malformed, was tampered with, or belongs to another context. */
export class SecretDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretDecryptionError";
  }
}
