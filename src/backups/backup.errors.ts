/** Thrown when a backup is too large to be encrypted in memory and sent. */
export class BackupTooLargeError extends Error {
  constructor(sizeInBytes: number, limitInBytes: number) {
    super(`Backup has ${sizeInBytes} bytes, exceeding the ${limitInBytes} byte limit`);
    this.name = "BackupTooLargeError";
  }
}

/** Thrown when a restore would overwrite a file or the backup is not a SQLite database. */
export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreError";
  }
}
