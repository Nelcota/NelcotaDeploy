import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { z } from "zod";

import { AuditTab, OrganizationTab, ServersTab, ServerTab, TokensTab, UsersTab } from "@/web/admin";
import { SETTINGS_SECTIONS as SETTINGS_NAVIGATION } from "@/web/components/shell/navigation";
import { PageHeader } from "@/web/components/shell/page-header";
import { useCan } from "@/web/components/shell/use-permissions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/web/components/ui/tabs";

/** Sections of the settings page, also linked from the context sidebar. */
const SETTINGS_SECTIONS = [
  "organization",
  "users",
  "servers",
  "server",
  "tokens",
  "audit",
] as const;

export const Route = createFileRoute("/_app/settings")({
  validateSearch: z.object({ tab: z.enum(SETTINGS_SECTIONS).optional() }),
  head: () => ({ meta: [{ title: "Administração · Nelcota Deploy" }] }),
  component: SettingsPage,
});

/** Icon of a settings tab, shared with the command palette's list of settings pages. */
function SettingsTabIcon({ tab }: { readonly tab: (typeof SETTINGS_SECTIONS)[number] }) {
  const Icon = SETTINGS_NAVIGATION.find((item) => item.tab === tab)?.icon;
  return Icon == null ? null : <Icon aria-hidden />;
}

const SETTINGS_TITLES: Record<(typeof SETTINGS_SECTIONS)[number], string> = {
  organization: "Organização",
  users: "Usuários",
  servers: "Servidores",
  server: "Sistema",
  tokens: "Tokens de API",
  audit: "Auditoria",
};

/** Permission each section needs; sections without one are visible to everyone here. */
const SECTION_PERMISSIONS: Record<
  (typeof SETTINGS_SECTIONS)[number],
  "user:manage" | "token:manage" | "audit:read" | null
> = {
  organization: null,
  users: "user:manage",
  servers: null,
  server: null,
  tokens: "token:manage",
  audit: "audit:read",
};

const SETTINGS_DESCRIPTIONS: Record<(typeof SETTINGS_SECTIONS)[number], string> = {
  organization: "Nome da organização e domínio base dos projetos.",
  users: "Quem acessa o painel e o que cada pessoa pode fazer.",
  servers: "As VPSs onde as aplicações rodam, com uso de recursos e estado da conexão.",
  server: "Estado do worker e configuração do webhook.",
  tokens: "Tokens para o servidor MCP e outras integrações.",
  audit: "Registro de quem fez o quê, e webhooks recebidos.",
};

function SettingsPage() {
  const can = useCan();
  const navigate = Route.useNavigate();
  const { tab = "organization" } = Route.useSearch();
  const canSee = (section: (typeof SETTINGS_SECTIONS)[number]): boolean => {
    const permission = SECTION_PERMISSIONS[section];
    return permission == null || can(permission);
  };
  // A link to a section this user cannot open falls back to the first one instead of a blank page.
  const activeTab = canSee(tab) ? tab : "organization";
  const tabListRef = useActiveTabInView(activeTab);
  return (
    <>
      <PageHeader title="Administração" description={SETTINGS_DESCRIPTIONS[activeTab]} />
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const section = SETTINGS_SECTIONS.find((candidate) => candidate === value);
          void navigate({ search: { tab: section } });
        }}
        className="gap-8"
      >
        <TabsList
          ref={tabListRef}
          aria-label="Seções da administração"
          className="[scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]"
        >
          {SETTINGS_SECTIONS.filter((section) => canSee(section)).map((section) => (
            <TabsTrigger key={section} value={section}>
              <SettingsTabIcon tab={section} />
              {SETTINGS_TITLES[section]}
            </TabsTrigger>
          ))}
        </TabsList>
        <SettingsTabPanels />
      </Tabs>
    </>
  );
}

/** Keeps the open tab in view when the tab list scrolls sideways on phones, also after a link. */
function useActiveTabInView(activeTab: string) {
  const tabListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabListRef.current
      ?.querySelector("[data-state=active]")
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTab]);
  return tabListRef;
}

function SettingsTabPanels() {
  const can = useCan();
  return (
    <>
      <TabsContent value="organization">
        <OrganizationTab canEdit={can("settings:write")} />
      </TabsContent>
      {can("user:manage") ? (
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
      ) : null}
      <TabsContent value="servers">
        <ServersTab canEdit={can("settings:write")} />
      </TabsContent>
      <TabsContent value="server">
        <ServerTab />
      </TabsContent>
      {can("token:manage") ? (
        <TabsContent value="tokens">
          <TokensTab />
        </TabsContent>
      ) : null}
      {can("audit:read") ? (
        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>
      ) : null}
    </>
  );
}
