/** Thrown when a command cannot be expressed safely for a remote shell. */
export class InvalidRemoteCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRemoteCommandError";
  }
}

/** Thrown when an SSH connection or channel cannot be opened. */
export class SshConnectionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SshConnectionError";
  }
}

/** Thrown when a server presents a host key other than the one pinned for it. */
export class HostKeyMismatchError extends Error {
  constructor(host: string, expected: string, received: string) {
    super(
      `Host key of ${host} changed: expected ${expected}, received ${received}. ` +
        "Remove and add the server again only if the server was reinstalled.",
    );
    this.name = "HostKeyMismatchError";
  }
}
