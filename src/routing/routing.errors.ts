/** Thrown when a route would carry a value that could break or widen the proxy configuration. */
export class InvalidRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRouteError";
  }
}

/** Thrown when a route file cannot be written or removed on a server. */
export class RouteFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteFileError";
  }
}
