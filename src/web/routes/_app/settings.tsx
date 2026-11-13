import { createFileRoute } from "@tanstack/react-router";

import { AdministrationLayout } from "@/web/admin";

export const Route = createFileRoute("/_app/settings")({ component: AdministrationLayout });
