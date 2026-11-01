/** Thrown when two routes, or an application and the panel, claim the same hostname. */
export class HostnameConflictError extends Error {
  constructor(hostname: string) {
    super(`Hostname ${hostname} is already reserved by another route`);
    this.name = "HostnameConflictError";
  }
}
