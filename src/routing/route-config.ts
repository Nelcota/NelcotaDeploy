import { InvalidRouteError } from "./routing.errors";

const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const ROUTE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PORT = 65_535;
const HTTPS_REDIRECT_MIDDLEWARE = "nelcota-https-redirect";
const COMPRESS_MIDDLEWARE = "nelcota-compress";

/** Routing settings for one public hostname. */
export type RoutedDomain = { readonly hostname: string; readonly httpsEnabled: boolean };

/** Proxy entrypoints and certificate resolver of a server. */
export type ProxyEntrypoints = {
  readonly http: string;
  readonly https: string;
  readonly certResolver: string;
};

type Router = {
  readonly rule: string;
  readonly entryPoints: readonly string[];
  readonly service: string;
  readonly middlewares?: readonly string[];
  readonly tls?: { readonly certResolver: string };
};

/** The subset of Traefik's dynamic configuration the platform writes. */
export type DynamicConfig = {
  readonly http: {
    readonly routers?: Readonly<Record<string, Router>>;
    readonly services?: Readonly<
      Record<string, { readonly loadBalancer: { readonly servers: readonly { url: string }[] } }>
    >;
    readonly middlewares?: Readonly<Record<string, unknown>>;
  };
};

function assertMatches(value: string, pattern: RegExp, what: string): void {
  if (pattern.test(value) === false) {
    throw new InvalidRouteError(`Invalid ${what}: ${JSON.stringify(value)}`);
  }
}

function assertEntrypoints(entrypoints: ProxyEntrypoints): void {
  assertMatches(entrypoints.http, NAME_PATTERN, "HTTP entrypoint");
  assertMatches(entrypoints.https, NAME_PATTERN, "HTTPS entrypoint");
  assertMatches(entrypoints.certResolver, NAME_PATTERN, "certificate resolver");
}

/**
 * Middlewares every project's routes use, written once per server.
 *
 * @param compress - Whether routes compress responses themselves; off where the proxy already
 *   compresses on its entrypoint.
 * @returns The shared dynamic configuration.
 */
export function sharedRouteConfig(compress: boolean): DynamicConfig {
  const middlewares: Record<string, unknown> = {
    [HTTPS_REDIRECT_MIDDLEWARE]: { redirectScheme: { scheme: "https" } },
  };
  if (compress) {
    middlewares[COMPRESS_MIDDLEWARE] = { compress: {} };
  }
  return { http: { middlewares } };
}

function domainRouters(
  domain: RoutedDomain,
  route: {
    readonly name: string;
    readonly service: string;
    readonly entrypoints: ProxyEntrypoints;
    readonly compress: boolean;
  },
): Record<string, Router> {
  assertMatches(domain.hostname, HOSTNAME_PATTERN, "hostname");
  const rule = `Host(\`${domain.hostname}\`)`;
  const middlewares = route.compress ? [COMPRESS_MIDDLEWARE] : [];
  if (domain.httpsEnabled === false) {
    return {
      [route.name]: {
        rule,
        entryPoints: [route.entrypoints.http],
        service: route.service,
        middlewares,
      },
    };
  }
  return {
    [route.name]: {
      rule,
      entryPoints: [route.entrypoints.https],
      service: route.service,
      middlewares,
      tls: { certResolver: route.entrypoints.certResolver },
    },
    [`${route.name}-http`]: {
      rule,
      entryPoints: [route.entrypoints.http],
      service: route.service,
      middlewares: [HTTPS_REDIRECT_MIDDLEWARE],
    },
  };
}

/**
 * Builds the routes that send each of a project's hostnames to exactly one container.
 *
 * @remarks
 * Pointing the routes at a single container, rather than labelling containers, lets a new
 * version take all traffic at once: the old container stops receiving requests before it is
 * asked to stop.
 *
 * @param input - Route name (unique per project or preview), hostnames, the container and its
 *   port, the server's entrypoints and whether routes compress responses.
 * @returns The dynamic configuration; no routers when there is no hostname.
 * @throws {InvalidRouteError} When the name, a hostname, the container name, the port or an
 *   entrypoint is invalid.
 */
export function projectRouteConfig(input: {
  /** Base of the service and router names, such as "api" or "api-pr-12". */
  readonly routeName: string;
  readonly domains: readonly RoutedDomain[];
  readonly containerName: string;
  readonly internalPort: number;
  readonly entrypoints: ProxyEntrypoints;
  readonly compress: boolean;
}): DynamicConfig {
  assertMatches(input.routeName, ROUTE_NAME_PATTERN, "route name");
  assertMatches(input.containerName, CONTAINER_NAME_PATTERN, "container name");
  assertEntrypoints(input.entrypoints);
  if (
    Number.isInteger(input.internalPort) === false ||
    input.internalPort < 1 ||
    input.internalPort > MAX_PORT
  ) {
    throw new InvalidRouteError(`Invalid internal port: ${input.internalPort}`);
  }
  const service = `nelcota-${input.routeName}`;
  const routers: Record<string, Router> = {};
  input.domains.forEach((domain, index) => {
    Object.assign(
      routers,
      domainRouters(domain, {
        name: `${service}-${index}`,
        service,
        entrypoints: input.entrypoints,
        compress: input.compress,
      }),
    );
  });
  return {
    http: {
      routers,
      services: {
        // Containers on the proxy network reach each other by name.
        [service]: {
          loadBalancer: {
            servers: [{ url: `http://${input.containerName}:${input.internalPort}` }],
          },
        },
      },
    },
  };
}
