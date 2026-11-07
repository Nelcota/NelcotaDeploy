import { expect, test } from "bun:test";

import {
  generateApplicationSecret,
  isApplicationSecretKey,
  isApplicationUrlKey,
} from "./variable-defaults";

test.each([
  "BETTER_AUTH_SECRET",
  "AUTH_SECRET",
  "SESSION_SECRET",
  "JWT_SECRET",
  "APP_SECRET",
  "COOKIE_SECRET",
  "SIGNING_SECRET",
])("recognizes the local signing secret %s", (key) => {
  expect(isApplicationSecretKey(key)).toBe(true);
});

test.each(["", "API_KEY", "DATABASE_URL", "STRIPE_SECRET", "AUTH_SECRET_BACKUP", "PRIVATE_KEY"])(
  "never generates an external credential for %s",
  (key) => {
    expect(isApplicationSecretKey(key)).toBe(false);
  },
);

test.each([
  "APP_URL",
  "PUBLIC_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXTAUTH_URL",
  "VITE_APP_URL",
  "SITE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "BETTER_AUTH_URL",
  "AUTH_URL",
])("recognizes the application URL key %s", (key) => {
  expect(isApplicationUrlKey(key)).toBe(true);
});

test.each(["", "API_URL", "DATABASE_URL", "REDIS_URL", "WEBHOOK_URL", "APP_URL_BACKUP"])(
  "leaves external addresses manual for %s",
  (key) => {
    expect(isApplicationUrlKey(key)).toBe(false);
  },
);

test("generates distinct schema-compatible 256-bit signing secrets", () => {
  const secrets = Array.from({ length: 100 }, generateApplicationSecret);

  expect(new Set(secrets).size).toBe(secrets.length);
  expect(secrets.every((value) => /^[a-f0-9]{64}$/.test(value))).toBe(true);
});
