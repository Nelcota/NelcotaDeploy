import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

import { createLogger } from "@/logging";
import { GENERIC_ERROR_MESSAGE, PublicError, toPublicError } from "@/web/server/public-error";

const SERVER_FUNCTION_PREFIX = "/_serverFn/";
const HSTS_MAX_AGE_IN_SECONDS = 31_536_000;

/** Rejects cross-site calls to server functions (all mutations go through them). */
const csrfMiddleware = createCsrfMiddleware({
  filter: ({ request }) => new URL(request.url).pathname.startsWith(SERVER_FUNCTION_PREFIX),
});

const securityHeadersMiddleware = createMiddleware().server(async ({ next, request }) => {
  const result = await next();
  const headers = result.response.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env["NODE_ENV"] === "production") {
    // Hydration and the theme bootstrap use inline scripts, so 'unsafe-inline' is needed.
    // Routes that set a stricter policy of their own (avatars, the GitHub App pages) keep it.
    if (headers.has("Content-Security-Policy") === false) {
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    }
    if (new URL(request.url).protocol === "https:") {
      headers.set(
        "Strict-Transport-Security",
        `max-age=${HSTS_MAX_AGE_IN_SECONDS}; includeSubDomains`,
      );
    }
  }
  return result;
});

/** Replaces internal error details with a safe Portuguese message before they reach the browser. */
const publicErrorMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof Error === false) {
      // Redirects and not-found signals are not errors and must pass through untouched.
      throw error;
    }
    const publicError = toPublicError(error);
    if (publicError != null) {
      throw publicError;
    }
    createLogger("web").error({ err: error }, "server function failed");
    throw new PublicError(GENERIC_ERROR_MESSAGE);
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware, csrfMiddleware],
  functionMiddleware: [publicErrorMiddleware],
}));
