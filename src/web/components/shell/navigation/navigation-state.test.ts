import { expect, test } from "bun:test";

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { activeNavigationHref } from "./navigation-state";

const DESTINATIONS = [
  { href: "/projects/app", to: "/projects/$projectId", params: { projectId: "app" }, exact: true },
  {
    href: "/projects/app/settings",
    to: "/projects/$projectId/settings",
    params: { projectId: "app" },
  },
  {
    href: "/projects/app/settings/build",
    to: "/projects/$projectId/settings/build",
    params: { projectId: "app" },
    exact: true,
  },
];

async function activeHrefAt(
  pathname: string,
  destinations: Parameters<typeof activeNavigationHref>[0] = DESTINATIONS,
) {
  const root = createRootRoute();
  const project = createRoute({ getParentRoute: () => root, path: "/projects/$projectId" });
  const settings = createRoute({ getParentRoute: () => project, path: "settings" });
  const build = createRoute({ getParentRoute: () => settings, path: "build" });
  const router = createRouter({
    routeTree: root.addChildren([project.addChildren([settings.addChildren([build])])]),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  await router.load();
  return activeNavigationHref(destinations, ({ to, params, ...options }) =>
    router.matchRoute({ to, params }, options),
  );
}

test("highlights the deepest page instead of its parent", async () => {
  expect(await activeHrefAt("/projects/app/settings/build")).toBe("/projects/app/settings/build");
});

test("highlights a parent for resource-specific child pages", async () => {
  expect(await activeHrefAt("/projects/app/settings/runtime/details")).toBe(
    "/projects/app/settings",
  );
});

test.each(["/projects/application", "/projects/app/settings-old", "", " "])(
  "does not highlight a partial or blank path: %s",
  async (path) => {
    expect(await activeHrefAt(path)).toBeNull();
  },
);

test("treats trailing slashes as the same destination", async () => {
  expect(await activeHrefAt("/projects/app/settings/build/")).toBe("/projects/app/settings/build");
});

test("does not select the home page for a deeper path", async () => {
  expect(await activeHrefAt("/projects", [{ href: "/", to: "/", exact: true }])).toBeNull();
});

test("handles an empty catalog and ignores invalid empty destinations", async () => {
  expect(await activeHrefAt("/", [])).toBeNull();
  expect(await activeHrefAt("/", [{ href: " ", to: " " }])).toBeNull();
});

test.each(["/PROJECTS/app/SETTINGS/BUILD", "/projects/app/settings/build?filter=all#details"])(
  "follows the router's path matching for %s",
  async (path) => {
    expect(await activeHrefAt(path)).toBe("/projects/app/settings/build");
  },
);

test("matches encoded project parameters without comparing their raw text", async () => {
  expect(
    await activeHrefAt("/projects/my%20app/settings", [
      {
        href: "/projects/my%20app/settings",
        to: "/projects/$projectId/settings",
        params: { projectId: "my app" },
      },
    ]),
  ).toBe("/projects/my%20app/settings");
});

test("does not treat an exact destination as active on a child page", async () => {
  expect(
    await activeHrefAt("/projects/app/settings/build/details", [
      {
        href: "/projects/app/settings/build",
        to: "/projects/$projectId/settings/build",
        params: { projectId: "app" },
        exact: true,
      },
    ]),
  ).toBeNull();
});
