import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { AppShell } from "@/web/components/app-shell";
import { getSessionFn } from "@/web/functions/session.functions";

export const Route = createFileRoute("/_app")({
  // The admin area renders in the browser only: every read is an authorized server
  // function call, and there is nothing to gain from server rendering private pages.
  ssr: false,
  beforeLoad: async ({ location }) => {
    const user = await getSessionFn();
    if (user == null) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    return { user };
  },
  component: AppLayout,
});

function AppLayout() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}
