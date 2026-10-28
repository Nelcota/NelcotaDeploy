import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

const STALE_TIME_IN_MS = 5000;

/** Creates the router with a fresh query cache per request (server) or per tab (browser). */
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: STALE_TIME_IN_MS, retry: 1, refetchOnWindowFocus: true },
    },
  });
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Pages scroll inside the app panel, not the window, so new pages start at its top.
    scrollToTopSelectors: ["#main"],
    defaultPreload: "intent",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
