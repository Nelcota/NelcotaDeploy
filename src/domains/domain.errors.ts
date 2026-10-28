/** Thrown when a hostname is already routed to a project. */
export class DomainTakenError extends Error {
  constructor(hostname: string) {
    super(`Domain ${hostname} is already in use`);
    this.name = "DomainTakenError";
  }
}

/** Thrown when a domain id does not belong to the project. */
export class DomainNotFoundError extends Error {
  constructor(domainId: string) {
    super(`Domain ${domainId} not found`);
    this.name = "DomainNotFoundError";
  }
}
