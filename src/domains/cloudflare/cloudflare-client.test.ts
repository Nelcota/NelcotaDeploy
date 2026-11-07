import { expect, test } from "bun:test";

import Cloudflare from "cloudflare";

import { CloudflareApiError } from "../domain.errors";
import { cloudflareFailure } from "./cloudflare-client";

test("preserves a validated application error", () => {
  const error = new CloudflareApiError(403);

  const result = cloudflareFailure(error);

  expect(result).toBe(error);
});

test("retains the HTTP status without exposing an SDK error body", () => {
  const credential = "test-private-provider-credential";
  const error = new Cloudflare.APIError(403, { message: credential }, credential, new Headers());

  const result = cloudflareFailure(error);

  expect(result.status).toBe(403);
  expect(result.message).not.toContain(credential);
});

test.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 99, 600, 403.5])(
  "does not propagate the invalid SDK status %p",
  (status) => {
    const error = new Cloudflare.APIError(status, {}, undefined, new Headers());

    const result = cloudflareFailure(error);

    expect(result.status).toBeNull();
  },
);

test("sanitizes an unknown transport error", () => {
  const error = new Error("private transport details");

  const result = cloudflareFailure(error);

  expect(result.status).toBeNull();
  expect(result.message).not.toContain(error.message);
});
