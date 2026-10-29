const PROBE_TIMEOUT_IN_MS = 3000;
const HTTP_SUCCESS_LIMIT = 400;

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
      const socket = await Promise.race([
        Bun.connect({ hostname: host, port, socket: { data() {} } }),
        Bun.sleep(PROBE_TIMEOUT_IN_MS).then(() => null),
      ]);
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
