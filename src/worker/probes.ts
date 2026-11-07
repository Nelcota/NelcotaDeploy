/** Longest a single probe may take, on any server. */
export const PROBE_TIMEOUT_IN_MS = 3000;
/** HTTP statuses below this count as healthy (redirects included). */
export const HTTP_SUCCESS_LIMIT = 400;

/**
 * Network probes that tell whether a container answers. Each server has its own: direct
 * connections here, SSH tunnels on a remote server. Tests replace them.
 */
export type Probes = {
  readonly http: (url: string) => Promise<boolean>;
  readonly tcp: (host: string, port: number) => Promise<boolean>;
};

/** Probes using fetch and Bun.connect. */
export const networkProbes: Probes = {
  async http(url) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_IN_MS),
      });
      await response.body?.cancel();
      return response.status < HTTP_SUCCESS_LIMIT;
    } catch {
      return false;
    }
  },
  async tcp(host, port) {
    try {
      let expired = false;
      const { promise: timeout, resolve } = Promise.withResolvers<null>();
      const timer = setTimeout(() => {
        expired = true;
        resolve(null);
      }, PROBE_TIMEOUT_IN_MS);
      using _timer = { [Symbol.dispose]: () => clearTimeout(timer) };
      const opening = Bun.connect({ hostname: host, port, socket: { data() {} } }).then(
        (socket) => {
          if (expired) {
            socket.end();
            return null;
          }
          return socket;
        },
      );
      const socket = await Promise.race([opening, timeout]);
      if (socket == null) {
        return false;
      }
      socket.end();
      return true;
    } catch {
      return false;
    }
  },
};
