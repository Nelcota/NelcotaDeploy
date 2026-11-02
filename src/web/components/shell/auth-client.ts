import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser client for the Better Auth endpoints under /api/auth, with two-factor sign-in. */
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
