import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";

import { getConfig, requireConfigValue } from "@/config";
import { type Database, getDatabase, tables } from "@/db";
import { PASSWORD_MIN_LENGTH } from "@/shared/schemas/user.schema";

const SECONDS_PER_DAY = 86_400;
const SESSION_LIFETIME_IN_DAYS = 7;
const SESSION_LIFETIME_IN_SECONDS = SESSION_LIFETIME_IN_DAYS * SECONDS_PER_DAY;
const SESSION_REFRESH_AGE_IN_SECONDS = SECONDS_PER_DAY;
const RATE_LIMIT_WINDOW_IN_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 100;
const SIGN_IN_MAX_ATTEMPTS_PER_WINDOW = 5;

const BUN_PASSWORD_HASHING = {
  hash: async (password: string) => await Bun.password.hash(password),
  verify: async ({ hash, password }: { hash: string; password: string }) =>
    await Bun.password.verify(password, hash),
};

const EMAIL_AND_PASSWORD = {
  enabled: true,
  disableSignUp: true,
  minPasswordLength: PASSWORD_MIN_LENGTH,
  password: BUN_PASSWORD_HASHING,
};

const USER_FIELDS = {
  additionalFields: {
    role: { type: "string", input: false, defaultValue: "viewer" },
    disabled: { type: "boolean", input: false, defaultValue: false },
  },
} as const;

const SESSION = {
  expiresIn: SESSION_LIFETIME_IN_SECONDS,
  updateAge: SESSION_REFRESH_AGE_IN_SECONDS,
};

const RATE_LIMIT = {
  enabled: true,
  window: RATE_LIMIT_WINDOW_IN_SECONDS,
  max: RATE_LIMIT_MAX_REQUESTS,
  customRules: {
    "/sign-in/email": {
      window: RATE_LIMIT_WINDOW_IN_SECONDS,
      max: SIGN_IN_MAX_ATTEMPTS_PER_WINDOW,
    },
  },
};

/**
 * "Sign in with GitHub": never creates accounts, and joins an existing one only through an
 * e-mail GitHub reports as verified (GitHub is not a trusted provider for linking).
 */
function socialSignIn(github: { readonly clientId: string; readonly clientSecret: string } | null) {
  return {
    socialProviders:
      github == null
        ? {}
        : {
            github: {
              clientId: github.clientId,
              clientSecret: github.clientSecret,
              disableSignUp: true,
            },
          },
    account: {
      accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: false },
    },
  };
}

/**
 * Creates the Better Auth instance.
 *
 * @remarks
 * Public sign-up is disabled: accounts come from the bootstrap command or from an admin.
 * Passwords use `Bun.password` (argon2id). Disabled users cannot open new sessions.
 *
 * With `github`, people can also sign in with GitHub, but only into an account that already
 * exists with the same e-mail, which GitHub must report as verified: GitHub never creates
 * accounts, and it is not a trusted provider for linking.
 *
 * @param database - Database that stores users and sessions.
 * @param options - Signing secret, the public URL of the panel and the GitHub OAuth client.
 * @returns The auth instance.
 */
export function createAuth(
  database: Database,
  options: {
    readonly secret: string;
    readonly baseURL: string;
    readonly github?: { readonly clientId: string; readonly clientSecret: string } | null;
  },
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
    ...socialSignIn(options.github ?? null),
    emailAndPassword: EMAIL_AND_PASSWORD,
    user: USER_FIELDS,
    session: SESSION,
    rateLimit: RATE_LIMIT,
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
let githubLogin: { readonly clientId: string; readonly clientSecret: string } | null = null;

/**
 * Turns "Sign in with GitHub" on with the app's OAuth client, or off with null. Better Auth
 * reads its providers once, so the next {@link getAuth} builds a new instance.
 *
 * @param credentials - OAuth client of the GitHub App, or null.
 */
export function configureGitHubLogin(
  credentials: { readonly clientId: string; readonly clientSecret: string } | null,
): void {
  githubLogin = credentials;
  sharedAuth = undefined;
}

/**
 * Tells whether people can sign in with GitHub.
 *
 * @returns True once {@link configureGitHubLogin} received an OAuth client.
 */
export function isGitHubLoginEnabled(): boolean {
  return githubLogin != null;
}

/**
 * Returns the process-wide auth instance.
 *
 * @throws {InvalidConfigError} When `BETTER_AUTH_SECRET` is not configured.
 */
export function getAuth(): Auth {
  sharedAuth ??= createAuth(getDatabase(), {
    secret: requireConfigValue("BETTER_AUTH_SECRET"),
    baseURL: getConfig().PUBLIC_URL,
    github: githubLogin,
  });
  return sharedAuth;
}
