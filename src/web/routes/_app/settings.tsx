import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { SETTINGS_SECTIONS } from "@/web/components/shell/navigation";
import { PageNavigation } from "@/web/components/shell/navigation/page-navigation";
import { useCan } from "@/web/components/shell/use-permissions";

export const Route = createFileRoute("/_app/settings")({ component: SettingsLayout });

function SettingsLayout() {
  const can = useCan();
  const items = SETTINGS_SECTIONS.filter(
    (section) => section.permission == null || can(section.permission),
  ).map((section) => ({
    href: section.to,
    to: section.to,
    label: section.label,
    group: section.group,
    exact: true,
    link: (
      <Link to={section.to} activeOptions={{ exact: true }} preload={false}>
        <section.icon aria-hidden />
        {section.label}
      </Link>
    ),
  }));
  return (
    <>
      <PageNavigation label="Páginas da administração" items={items} />
      <Outlet />
    </>
  );
}
