import { describe, expect, test } from "bun:test";

import { appRegistrationUrl, buildAppManifest, isGitHubAccountName } from "./github-app-manifest";

describe("buildAppManifest", () => {
  test("points the webhook and the callback at the panel", () => {
    const manifest = buildAppManifest("https://deploy.example.com");

    expect(manifest.hook_attributes.url).toBe("https://deploy.example.com/api/webhooks/github");
    expect(manifest.redirect_url).toBe("https://deploy.example.com/api/github/app/callback");
    expect(manifest.default_permissions).toEqual({ contents: "read", metadata: "read" });
    expect(manifest.default_events).toEqual(["push"]);
  });

  test("keeps the name within GitHub's 34 characters", () => {
    const manifest = buildAppManifest("https://a-very-long-subdomain-name.example.com");

    expect(manifest.name.length).toBe(34);
  });
});

describe("appRegistrationUrl", () => {
  test("creates the app under the user's account", () => {
    expect(appRegistrationUrl(null, "abc")).toBe("https://github.com/settings/apps/new?state=abc");
  });

  test("creates the app under an organization", () => {
    expect(appRegistrationUrl("acme", "abc")).toBe(
      "https://github.com/organizations/acme/settings/apps/new?state=abc",
    );
  });

  test("throws RangeError for an invalid organization name", () => {
    expect(() => appRegistrationUrl("acme/../x", "abc")).toThrow(RangeError);
  });
});

describe("isGitHubAccountName", () => {
  test.each([["acme"], ["acme-labs"], ["a1"]])("accepts %p", (name) => {
    expect(isGitHubAccountName(name)).toBe(true);
  });

  test.each([[""], ["-acme"], ["acme corp"], ["a".repeat(40)]])("rejects %p", (name) => {
    expect(isGitHubAccountName(name)).toBe(false);
  });
});
