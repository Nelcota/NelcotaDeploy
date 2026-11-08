import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouteContext,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { NotFoundPage, PageError } from "@/web/components/layout/states";
import { ThemeProvider } from "@/web/components/shell/theme";
import { Toaster } from "@/web/components/ui/sonner";
import { TooltipProvider } from "@/web/components/ui/tooltip";

import stylesUrl from "../styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Nelcota Deploy" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#111113" },
    ],
    links: [
      { rel: "stylesheet", href: stylesUrl },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: NotFoundPage,
  errorComponent: PageError,
});

function RootComponent() {
  const { queryClient } = useRouteContext({ from: "__root__" });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <Outlet />
          <Toaster closeButton position="top-right" />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function RootDocument({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <head>
        {/* Blocking on purpose: applies the saved theme before the first paint. */}
        <script src="/theme-init.js" />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
