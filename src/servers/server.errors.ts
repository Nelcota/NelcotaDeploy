/** Thrown when a server id does not exist. */
export class ServerNotFoundError extends Error {
  constructor(serverId: string) {
    super(`Server ${serverId} not found`);
    this.name = "ServerNotFoundError";
  }
}

/** Thrown when another server already uses a name or address. */
export class ServerTakenError extends Error {
  constructor(what: string) {
    super(`A server with this ${what} already exists`);
    this.name = "ServerTakenError";
  }
}

/** Thrown when a server still hosts projects or is the panel's own host. */
export class ServerInUseError extends Error {
  constructor(serverId: string, reason: string) {
    super(`Server ${serverId} cannot be removed: ${reason}`);
    this.name = "ServerInUseError";
  }
}

/** Thrown when no server can take a new project. */
export class NoServerAvailableError extends Error {
  constructor() {
    super("No server accepts new applications");
    this.name = "NoServerAvailableError";
  }
}

/** Thrown when the install command would be built from a malformed key or username. */
export class InvalidInstallInputError extends Error {
  constructor(what: string) {
    super(`Cannot build the install command: invalid ${what}`);
    this.name = "InvalidInstallInputError";
  }
}
