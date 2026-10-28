import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { AppSidebar } from "@/web/components/app-sidebar";
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
    <div className="flex min-h-svh flex-col md:flex-row">
      <AppSidebar user={user} />
      <main id="main" className="min-w-0 flex-1 px-5 py-8 md:px-10 md:py-10">
        <div className="mx-auto max-w-7xl space-y-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
