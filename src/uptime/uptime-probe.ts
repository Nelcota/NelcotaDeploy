import { isPublicIpAddress } from "@/domains";

/** How long a visitor would wait before giving up, in milliseconds. */
export const PROBE_TIMEOUT_IN_MS = 10_000;
const FIRST_SERVER_ERROR = 500;

/** Why a hostname counted as down. */
export type DownReason = "dns" | "timeout" | "certificate" | "connection" | "server-error";

/** What one check of a hostname found. */
export type ProbeResult =
  | {
      readonly kind: "checked";
      readonly up: boolean;
      readonly statusCode: number | null;
      readonly responseTimeInMs: number | null;
      readonly reason: DownReason | null;
    }
  /** The hostname points at a private address, which the panel never requests. */
  | { readonly kind: "private" };

/** The network access a check needs, replaced in tests. */
export type ProbeTools = {
  readonly lookup: (hostname: string) => Promise<string[]>;
  readonly fetch: typeof fetch;
  /** Monotonic clock in milliseconds. */
  readonly now: () => number;
};

/**
 * Requests a hostname's home page as a visitor would, through public DNS and the proxy, and
 * says whether it answered.
 *
 * @remarks
 * Any answer below 500 counts as up, redirects and "not found" included: the application is
 * there and replying. The response body is never read. Hostnames that resolve to a private,
 * loopback or link-local address are not requested, so the check cannot reach the internal
 * network.
 *
 * @param target - Hostname and whether it is served over HTTPS.
 * @param tools - DNS, fetch and clock.
 * @returns What the check found.
 */
export async function probeHostname(
  target: { readonly hostname: string; readonly httpsEnabled: boolean },
  tools: ProbeTools,
): Promise<ProbeResult> {
  const addresses = await tools.lookup(target.hostname);
  if (addresses.length === 0) {
    return down("dns");
  }
  if (addresses.some((address) => isPublicIpAddress(address) === false)) {
    return { kind: "private" };
  }
  const startedAt = tools.now();
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_IN_MS);
  let lastReason: DownReason = "connection";
  for (const address of addresses) {
    if (signal.aborted) {
      return down("timeout");
    }
    try {
      return await probeAddress(target, { address, signal, startedAt }, tools);
    } catch (error) {
      lastReason = reasonOf(error);
    }
  }
  return down(signal.aborted ? "timeout" : lastReason);
}

async function probeAddress(
  target: { readonly hostname: string; readonly httpsEnabled: boolean },
  request: { readonly address: string; readonly signal: AbortSignal; readonly startedAt: number },
  tools: ProbeTools,
): Promise<ProbeResult> {
  const scheme = target.httpsEnabled ? "https" : "http";
  const address = request.address.includes(":") ? `[${request.address}]` : request.address;
  // Dial the checked address directly; a second DNS lookup could point at a private server.
  const response = await tools.fetch(`${scheme}://${address}/`, {
    method: "GET",
    redirect: "manual",
    headers: { Host: target.hostname },
    ...(target.httpsEnabled ? { tls: { serverName: target.hostname } } : {}),
    proxy: false,
    signal: request.signal,
  });
  const responseTimeInMs = Math.max(0, Math.round(tools.now() - request.startedAt));
  await response.body?.cancel();
  const up = response.status < FIRST_SERVER_ERROR;
  return {
    kind: "checked",
    up,
    statusCode: response.status,
    responseTimeInMs,
    reason: up ? null : "server-error",
  };
}

/**
 * Tells why a request failed, from the error fetch threw.
 *
 * @param error - The error.
 * @returns The reason shown to people.
 */
export function reasonOf(error: unknown): DownReason {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "timeout";
  }
  const code = typeof error === "object" && error != null && "code" in error ? error.code : null;
  if (typeof code === "string" && code.includes("CERT")) {
    return "certificate";
  }
  return "connection";
}

function down(reason: DownReason): ProbeResult {
  return { kind: "checked", up: false, statusCode: null, responseTimeInMs: null, reason };
}
