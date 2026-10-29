import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";

import { getConfig, requireConfigValue } from "@/config";
import { type Database, getDatabase, tables } from "@/db";
import { PASSWORD_MIN_LENGTH } from "@/shared/schemas/user.schema";

const SECONDS_PER_DAY = 86_400;
const SESSION_LIFETIME_IN_SECONDS = 7 * SECONDS_PER_DAY;
const SESSION_REFRESH_AGE_IN_SECONDS = SECONDS_PER_DAY;
const RATE_LIMIT_WINDOW_IN_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 100;
const SIGN_IN_MAX_ATTEMPTS_PER_WINDOW = 5;

/**
 * Creates the Better Auth instance.
 *
 * @remarks
 * Public sign-up is disabled: accounts come from the bootstrap command or from an admin.
 * Passwords use `Bun.password` (argon2id). Disabled users cannot open new sessions.
 *
 * @param database - Database that stores users and sessions.
 * @param options - Signing secret and the public URL of the panel.
 * @returns The auth instance.
 */
function createAuth(
  database: Database,
  options: { readonly secret: string; readonly baseURL: string },
) {
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [options.baseURL],
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: {
        user: tables.users,
        session: tables.sessions,
        account: tables.accounts,
        verification: tables.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      password: {
        hash: async (password) => await Bun.password.hash(password),
        verify: async ({ hash, password }) => await Bun.password.verify(password, hash),
      },
    },
    user: {
      additionalFields: {
        role: { type: "string", input: false, defaultValue: "viewer" },
        disabled: { type: "boolean", input: false, defaultValue: false },
      },
    },
    session: {
      expiresIn: SESSION_LIFETIME_IN_SECONDS,
      updateAge: SESSION_REFRESH_AGE_IN_SECONDS,
    },
    rateLimit: {
      enabled: true,
      window: RATE_LIMIT_WINDOW_IN_SECONDS,
      max: RATE_LIMIT_MAX_REQUESTS,
      customRules: {
        "/sign-in/email": {
          window: RATE_LIMIT_WINDOW_IN_SECONDS,
          max: SIGN_IN_MAX_ATTEMPTS_PER_WINDOW,
        },
      },
    },
    advanced: {
      useSecureCookies: options.baseURL.startsWith("https://"),
      database: { generateId: () => Bun.randomUUIDv7() },
      // Traefik sets X-Real-IP to the client address; the panel is only reachable through it.
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },
    databaseHooks: {
      session: {
        create: {
          before: (session) => Promise.resolve(isUserActive(database, session.userId)),
        },
      },
    },
  });
}

function isUserActive(database: Database, userId: string): boolean {
  const user = database
    .select({ disabled: tables.users.disabled })
    .from(tables.users)
    .where(eq(tables.users.id, userId))
    .get();
  return user?.disabled === false;
}

export type Auth = ReturnType<typeof createAuth>;

let sharedAuth: Auth | undefined;

/**
 * Returns the process-wide auth instance.
 *
 * @throws {InvalidConfigError} When `BETTER_AUTH_SECRET` is not configured.
 */
export function getAuth(): Auth {
  sharedAuth ??= createAuth(getDatabase(), {
    secret: requireConfigValue("BETTER_AUTH_SECRET"),
    baseURL: getConfig().PUBLIC_URL,
  });
  return sharedAuth;
}
