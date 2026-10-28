import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import {
  KeyRoundIcon,
  LoaderCircleIcon,
  PlusIcon,
  ShieldIcon,
  UsersIcon,
  WandSparklesIcon,
  WebhookIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { formatBytes, formatDateTime, formatRelativeTime, pluralize } from "@/shared/format";
import { type Role, ROLES } from "@/shared/roles";
import { type SystemSettings, systemSettingsSchema } from "@/shared/settings.schema";
import { newUserSchema, PASSWORD_MIN_LENGTH, passwordSchema } from "@/shared/user.schema";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { CopyButton } from "@/web/components/copy-button";
import { toUserMessage } from "@/web/components/error-message";
import { FormField } from "@/web/components/form-field";
import { AUDIT_ACTION_LABELS, ROLE_LABELS, WEBHOOK_REASON_LABELS } from "@/web/components/labels";
import { List, ListRow, Section, StatRow } from "@/web/components/layout";
import { SETTINGS_SECTIONS as SETTINGS_NAVIGATION } from "@/web/components/navigation";
import { PageHeader } from "@/web/components/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { StatusPill } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { Checkbox } from "@/web/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/web/components/ui/tabs";
import { usagePercent } from "@/web/components/usage-meter";
import { useAction } from "@/web/components/use-action";
import { useCan } from "@/web/components/use-permissions";
import { UserAvatar } from "@/web/components/user-avatar";
import {
  createApiTokenFn,
  createUserFn,
  getSettingsFn,
  listApiTokensFn,
  listAuditEventsFn,
  listUsersFn,
  listWebhookDeliveriesFn,
  resetUserPasswordFn,
  revokeApiTokenFn,
  saveSettingsFn,
  setUserDisabledFn,
  updateUserRoleFn,
} from "@/web/functions/settings.functions";

/** Sections of the settings page, also linked from the context sidebar. */
const SETTINGS_SECTIONS = ["organization", "users", "server", "tokens", "audit"] as const;

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
  server: "Servidor",
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
  server: null,
  tokens: "token:manage",
  audit: "audit:read",
};

/** Usage at or above these percentages is shown as a warning or a problem. */
const USAGE_WARNING_PERCENT = 75;
const USAGE_DANGER_PERCENT = 90;

function usageTone(percent: number | null): "default" | "warning" | "danger" {
  if (percent == null || percent < USAGE_WARNING_PERCENT) {
    return "default";
  }
  return percent >= USAGE_DANGER_PERCENT ? "danger" : "warning";
}

function formatPercent(percent: number | null): string {
  return percent == null ? "—" : `${Math.round(percent)}%`;
}

const SETTINGS_DESCRIPTIONS: Record<(typeof SETTINGS_SECTIONS)[number], string> = {
  organization: "Nome da organização e domínio base dos projetos.",
  users: "Quem acessa o painel e o que cada pessoa pode fazer.",
  server: "Recursos da VPS, estado do worker e configuração do webhook.",
  tokens: "Tokens para o servidor MCP e outras integrações.",
  audit: "Registro de quem fez o quê, e webhooks recebidos.",
};

const GENERATED_PASSWORD_BYTES = 18;
const SERVER_REFRESH_INTERVAL_IN_MS = 15_000;
/** Characters of ids and SHAs shown in tables; the full value is in the audit details. */
const SHORT_ID_LENGTH = 12;
// Same limit the server applies to token validity.
const MAX_TOKEN_DAYS = 365;
const SHORT_SHA_LENGTH = 7;

/** Builds a strong random password in the browser with the Web Crypto API. */
function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GENERATED_PASSWORD_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

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
        <TabsList aria-label="Seções da administração">
          {SETTINGS_SECTIONS.filter((section) => canSee(section)).map((section) => (
            <TabsTrigger key={section} value={section}>
              <SettingsTabIcon tab={section} />
              {SETTINGS_TITLES[section]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="organization">
          <OrganizationTab canEdit={can("settings:write")} />
        </TabsContent>
        {can("user:manage") ? (
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
        ) : null}
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
      </Tabs>
    </>
  );
}

function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettingsFn(),
    refetchInterval: SERVER_REFRESH_INTERVAL_IN_MS,
  });
}

/* -------------------------------------------------------------------------- */
/* Organization                                                               */
/* -------------------------------------------------------------------------- */

function OrganizationTab({ canEdit }: { readonly canEdit: boolean }) {
  const settings = useSettings();
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  if (settings.data == null) {
    return <ListSkeleton rows={3} />;
  }
  return <OrganizationForm initial={settings.data.settings} canEdit={canEdit} />;
}

function OrganizationForm({
  initial,
  canEdit,
}: {
  readonly initial: SystemSettings;
  readonly canEdit: boolean;
}) {
  const [organizationName, setOrganizationName] = useState(initial.organizationName);
  const [baseDomain, setBaseDomain] = useState(initial.baseDomain ?? "");
  const [httpsByDefault, setHttpsByDefault] = useState(initial.httpsByDefault);
  const [errors, setErrors] = useState<{ organizationName?: string[]; baseDomain?: string[] }>({});
  const save = useAction({
    action: (data: z.input<typeof systemSettingsSchema>) => saveSettingsFn({ data }),
    successMessage: "Configurações salvas",
    invalidate: [["settings"], ["project"]],
  });

  const changed =
    organizationName !== initial.organizationName ||
    baseDomain !== (initial.baseDomain ?? "") ||
    httpsByDefault !== initial.httpsByDefault;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = systemSettingsSchema.safeParse({ organizationName, baseDomain, httpsByDefault });
    if (parsed.success === false) {
      setErrors(z.flattenError(parsed.error).fieldErrors);
      return;
    }
    setErrors({});
    save.mutate({ organizationName, baseDomain, httpsByDefault });
  };

  return (
    <Section title="Organização" description="Preferências que valem para todos os projetos.">
      <Card className="p-5">
        <form className="max-w-lg space-y-4" onSubmit={submit}>
          <FormField
            id="organization-name"
            label="Nome da organização"
            errors={errors.organizationName ?? []}
          >
            {(props) => (
              <Input
                {...props}
                disabled={canEdit === false}
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
              />
            )}
          </FormField>
          <FormField
            id="base-domain"
            label="Domínio base"
            hint="Com um domínio base, cada projeto recebe automaticamente o endereço <slug>.<domínio base>. Aponte um DNS curinga (*.apps.exemplo.com) para este servidor."
            errors={errors.baseDomain ?? []}
          >
            {(props) => (
              <Input
                {...props}
                className="font-mono"
                placeholder="apps.exemplo.com"
                disabled={canEdit === false}
                value={baseDomain}
                onChange={(event) => setBaseDomain(event.target.value)}
              />
            )}
          </FormField>
          <div className="flex items-start gap-3">
            <Switch
              id="https-default"
              disabled={canEdit === false}
              checked={httpsByDefault}
              onCheckedChange={setHttpsByDefault}
              aria-describedby="https-default-hint"
            />
            <div className="space-y-1">
              <Label htmlFor="https-default">HTTPS nos domínios automáticos</Label>
              <p id="https-default-hint" className="text-xs text-muted-foreground">
                O Traefik emite um certificado Let&apos;s Encrypt para cada domínio
                &lt;identificador&gt;.&lt;domínio base&gt;.
              </p>
            </div>
          </div>
          {canEdit ? (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={save.isPending || changed === false}>
                {save.isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
                Salvar
              </Button>
              {changed ? (
                <span className="text-sm text-muted-foreground">Alterações não salvas</span>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Somente administradores podem alterar estas configurações.
            </p>
          )}
        </form>
      </Card>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

function UsersTab() {
  const { user: currentUser } = useRouteContext({ from: "/_app" });
  const users = useQuery({ queryKey: ["users"], queryFn: () => listUsersFn() });
  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState<{ id: string; name: string } | null>(null);
  const [disablingUser, setDisablingUser] = useState<{ id: string; name: string } | null>(null);
  const updateRole = useAction({
    action: (input: { readonly userId: string; readonly role: Role }) =>
      updateUserRoleFn({ data: input }),
    successMessage: "Papel atualizado",
    invalidate: [["users"]],
  });
  const setDisabled = useAction({
    action: (input: { readonly userId: string; readonly disabled: boolean }) =>
      setUserDisabledFn({ data: input }),
    successMessage: (_result) => "Usuário atualizado",
    invalidate: [["users"]],
  });

  return (
    <Section
      title="Usuários"
      description="Administradores têm acesso total; desenvolvedores fazem deploys e gerenciam projetos; leitores só visualizam."
      action={
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon aria-hidden />
          Novo usuário
        </Button>
      }
    >
      {users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : null}
      {users.data == null && users.isError === false ? <ListSkeleton /> : null}
      {users.data?.length === 0 ? <EmptyState icon={UsersIcon} title="Nenhum usuário" /> : null}
      {users.data != null && users.data.length > 0 ? (
        <List>
          {users.data.map((user) => (
            <ListRow
              key={user.id}
              accent={user.disabled ? "neutral" : "none"}
              className="flex-wrap md:flex-nowrap"
            >
              <UserAvatar name={user.name} image={user.image} />
              <div className="min-w-0 flex-1 space-y-0.5 md:basis-auto">
                <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span className="truncate">{user.name}</span>
                  {user.id === currentUser.id ? (
                    <span className="shrink-0 font-normal text-muted-foreground">(você)</span>
                  ) : null}
                  {user.disabled ? <StatusPill tone="neutral" label="Desativado" /> : null}
                </p>
                <p className="text-sm break-all text-muted-foreground">{user.email}</p>
              </div>
              <span className="hidden shrink-0 text-xs text-muted-foreground lg:block">
                desde {formatDateTime(user.createdAt)}
              </span>
              <Select
                value={user.role}
                disabled={user.id === currentUser.id}
                onValueChange={(value) => {
                  const role = ROLES.find((candidate) => candidate === value);
                  if (role != null) {
                    updateRole.mutate({ userId: user.id, role });
                  }
                }}
              >
                <SelectTrigger
                  aria-label={`Papel de ${user.name}`}
                  className="w-40"
                  size="sm"
                  title={
                    user.id === currentUser.id ? "Você não pode alterar o próprio papel" : undefined
                  }
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Switch
                  id={`user-active-${user.id}`}
                  aria-label={`${user.name} ativo`}
                  checked={user.disabled === false}
                  disabled={user.id === currentUser.id}
                  title={
                    user.id === currentUser.id
                      ? "Você não pode desativar a própria conta"
                      : undefined
                  }
                  onCheckedChange={(active) => {
                    if (active) {
                      setDisabled.mutate({ userId: user.id, disabled: false });
                      return;
                    }
                    setDisablingUser({ id: user.id, name: user.name });
                  }}
                />
                <Label
                  htmlFor={`user-active-${user.id}`}
                  aria-hidden
                  className="text-sm font-normal"
                >
                  Ativo
                </Label>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setResetUser({ id: user.id, name: user.name })}
              >
                Redefinir senha
              </Button>
            </ListRow>
          ))}
        </List>
      ) : null}
      {/* Mounted only while open, so a cancelled draft and its password are not kept. */}
      {createOpen ? <CreateUserDialog open onOpenChange={setCreateOpen} /> : null}
      <ConfirmDialog
        open={disablingUser != null}
        onOpenChange={(open) => {
          if (open === false) {
            setDisablingUser(null);
          }
        }}
        title={`Desativar ${disablingUser?.name ?? "usuário"}?`}
        description="A pessoa perde o acesso e as sessões abertas são encerradas. Dá para reativar depois."
        confirmLabel="Desativar"
        destructive
        onConfirm={() => {
          if (disablingUser != null) {
            setDisabled.mutate({ userId: disablingUser.id, disabled: true });
          }
        }}
      />
      {resetUser == null ? null : (
        <ResetPasswordDialog
          key={resetUser.id}
          user={resetUser}
          onClose={() => setResetUser(null)}
        />
      )}
    </Section>
  );
}

function PasswordInput({
  props,
  value,
  onChange,
}: {
  readonly props: { id: string; "aria-describedby": string; "aria-invalid": boolean };
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input
        {...props}
        className="font-mono sm:flex-1"
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => onChange(generatePassword())}>
          <WandSparklesIcon aria-hidden />
          Gerar senha
        </Button>
        {value === "" ? null : <CopyButton text={value} label="Copiar" />}
      </div>
    </div>
  );
}

type NewUserForm = { name: string; email: string; role: Role; password: string };

function CreateUserDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState<NewUserForm>({
    name: "",
    email: "",
    role: "developer",
    password: "",
  });
  const create = useAction({
    action: (data: NewUserForm) => createUserFn({ data }),
    successMessage: "Usuário criado. Envie a senha por um canal seguro.",
    invalidate: [["users"]],
    onSuccess: () => {
      setForm({ name: "", email: "", role: "developer", password: "" });
      onOpenChange(false);
    },
  });
  const [errors, setErrors] = useState<Partial<Record<keyof NewUserForm, string[]>>>({});
  const update = (patch: Partial<NewUserForm>) => setForm((current) => ({ ...current, ...patch }));
  const submit = () => {
    const parsed = newUserSchema.safeParse(form);
    if (parsed.success === false) {
      setErrors(z.flattenError(parsed.error).fieldErrors);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo usuário</DialogTitle>
          <DialogDescription>
            Não há cadastro público: só administradores criam contas.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormField id="user-name" label="Nome" errors={errors.name ?? []}>
            {(props) => (
              <Input
                {...props}
                value={form.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            )}
          </FormField>
          <FormField id="user-email" label="E-mail" errors={errors.email ?? []}>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(event) => update({ email: event.target.value })}
              />
            )}
          </FormField>
          <FormField id="user-role" label="Papel">
            {(props) => (
              <Select
                value={form.role}
                onValueChange={(value) =>
                  update({ role: ROLES.find((role) => role === value) ?? "viewer" })
                }
              >
                <SelectTrigger {...props} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField
            id="user-password"
            label="Senha inicial"
            hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`}
            errors={errors.password ?? []}
          >
            {(props) => (
              <PasswordInput
                props={props}
                value={form.password}
                onChange={(password) => update({ password })}
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              Criar usuário
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
}: {
  readonly user: { readonly id: string; readonly name: string };
  readonly onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const reset = useAction({
    action: () => resetUserPasswordFn({ data: { userId: user.id, password } }),
    successMessage: "Senha redefinida. As sessões do usuário foram encerradas.",
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redefinir senha de {user.name}</DialogTitle>
          <DialogDescription>As sessões abertas desse usuário serão encerradas.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = passwordSchema.safeParse(password);
            if (parsed.success === false) {
              setErrors(parsed.error.issues.map((issue) => issue.message));
              return;
            }
            setErrors([]);
            reset.mutate();
          }}
        >
          <FormField
            id="reset-password"
            label="Nova senha"
            hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`}
            errors={errors}
          >
            {(props) => <PasswordInput props={props} value={password} onChange={setPassword} />}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={reset.isPending}>
              Redefinir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Server                                                                     */
/* -------------------------------------------------------------------------- */

function InfoRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function ServerTab() {
  const settings = useSettings();
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  if (settings.data == null) {
    return <ListSkeleton rows={4} />;
  }
  const { server } = settings.data;
  const host = server.hostSample;
  const now = new Date();
  const cpuPercent = host?.cpuPercent ?? null;
  const memoryPercent = usagePercent(host?.memoryUsedBytes, host?.memoryTotalBytes);
  const diskPercent = usagePercent(host?.diskUsedBytes, host?.diskTotalBytes);
  return (
    <div className="space-y-10">
      <Section
        title="Servidor (VPS)"
        description={
          host == null
            ? "Nenhuma amostra coletada ainda."
            : `Última amostra ${formatRelativeTime(host.createdAt, now)}.`
        }
      >
        <StatRow
          stats={[
            { label: "CPU", value: formatPercent(cpuPercent), tone: usageTone(cpuPercent) },
            {
              label: "Memória",
              value: formatPercent(memoryPercent),
              tone: usageTone(memoryPercent),
              detail:
                host == null
                  ? undefined
                  : `${formatBytes(host.memoryUsedBytes)} de ${formatBytes(host.memoryTotalBytes)}`,
            },
            {
              label: "Disco",
              value: formatPercent(diskPercent),
              tone: usageTone(diskPercent),
              detail:
                host == null
                  ? undefined
                  : `${formatBytes(host.diskUsedBytes)} de ${formatBytes(host.diskTotalBytes)}`,
            },
          ]}
        />
      </Section>
      <Section title="Worker e Docker">
        <dl className="divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border/70">
          <InfoRow label="Worker">
            {server.worker == null ? (
              <StatusPill tone="danger" label="Nunca conectou" />
            ) : (
              <StatusPill
                tone={server.worker.online ? "success" : "danger"}
                label={server.worker.online ? "Online" : "Offline"}
              />
            )}
          </InfoRow>
          <InfoRow label="Último sinal do worker">
            {formatRelativeTime(server.worker?.lastSeenAt, now)}
          </InfoRow>
          <InfoRow label="Docker">
            {server.worker?.dockerAvailable === true
              ? (server.worker.dockerVersion ?? "Disponível")
              : "Indisponível"}
          </InfoRow>
          <InfoRow label="Rede Docker">
            <span className="font-mono">{server.dockerNetwork}</span>
          </InfoRow>
          <InfoRow label="Traefik">{server.traefikEnabled ? "Ativado" : "Desativado"}</InfoRow>
          <InfoRow label="Jobs simultâneos">{server.workerConcurrency}</InfoRow>
          <InfoRow label="Coleta de métricas">
            a cada {server.metricsIntervalInSeconds} s, retenção de {server.metricsRetentionInHours}{" "}
            h
          </InfoRow>
          <InfoRow label="Fuso dos agendamentos">{server.scheduleTimeZone}</InfoRow>
          <InfoRow label="Chave de criptografia">
            <StatusPill
              tone={server.encryptionConfigured ? "success" : "danger"}
              label={server.encryptionConfigured ? "Configurada" : "Ausente"}
            />
          </InfoRow>
        </dl>
      </Section>
      <Section
        title="Webhook do GitHub"
        description="Deploy automático a cada push na branch configurada de projetos com deploy automático ativo."
      >
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-secondary px-2 py-1 font-mono text-sm break-all ring-1 ring-border ring-inset">
            {server.webhookUrl}
          </code>
          <CopyButton text={server.webhookUrl} label="Copiar URL" />
          <StatusPill
            tone={server.webhookConfigured ? "success" : "warning"}
            label={
              server.webhookConfigured ? "Segredo configurado" : "GITHUB_WEBHOOK_SECRET ausente"
            }
          />
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>No repositório, abra Settings → Webhooks → Add webhook.</li>
          <li>Payload URL: a URL acima. Content type: application/json.</li>
          <li>Secret: o mesmo valor de GITHUB_WEBHOOK_SECRET do servidor.</li>
          <li>Eventos: “Just the push event”.</li>
        </ol>
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* API tokens                                                                 */
/* -------------------------------------------------------------------------- */

type TokenScope = "read" | "deploy";

const SCOPE_LABELS: Record<TokenScope, string> = {
  read: "Leitura (consultar projetos, deploys, logs e métricas)",
  deploy: "Deploy (disparar deploys e reiniciar contêineres)",
};

function TokensTab() {
  const tokens = useQuery({ queryKey: ["api-tokens"], queryFn: () => listApiTokensFn() });
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const revoke = useAction({
    action: (tokenId: string) => revokeApiTokenFn({ data: { tokenId } }),
    successMessage: "Token revogado",
    invalidate: [["api-tokens"]],
  });
  const now = new Date();
  return (
    <div className="space-y-10">
      <CreateTokenCard onCreated={setCreatedToken} />
      <Section
        title="Tokens existentes"
        description="Usados pelo servidor MCP. Apenas o hash do token é armazenado."
      >
        {tokens.isError ? (
          <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
        ) : null}
        {tokens.data == null && tokens.isError === false ? <ListSkeleton rows={2} /> : null}
        {tokens.data?.length === 0 ? (
          <EmptyState icon={KeyRoundIcon} title="Nenhum token criado" />
        ) : null}
        {tokens.data != null && tokens.data.length > 0 ? (
          <List>
            {tokens.data.map((token) => (
              <ListRow
                key={token.id}
                accent={token.revokedAt == null ? "success" : "neutral"}
                className="flex-wrap md:flex-nowrap"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium">{token.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {token.scopes
                      .map((scope) => (scope === "deploy" ? "Deploy" : "Leitura"))
                      .join(" · ")}
                  </p>
                </div>
                <dl className="flex w-full gap-6 text-xs md:w-auto md:shrink-0">
                  <div>
                    <dt className="text-muted-foreground">Último uso</dt>
                    <dd>
                      {token.lastUsedAt == null
                        ? "Nunca usado"
                        : formatRelativeTime(token.lastUsedAt, now)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Expira em</dt>
                    <dd>
                      {token.expiresAt == null ? "Não expira" : formatDateTime(token.expiresAt)}
                    </dd>
                  </div>
                </dl>
                <StatusPill
                  tone={token.revokedAt == null ? "success" : "neutral"}
                  label={token.revokedAt == null ? "Ativo" : "Revogado"}
                />
                {token.revokedAt == null ? (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm">
                        Revogar
                      </Button>
                    }
                    title={`Revogar o token ${token.name}?`}
                    description="Clientes MCP que usam este token perdem o acesso imediatamente."
                    confirmLabel="Revogar"
                    destructive
                    onConfirm={() => revoke.mutate(token.id)}
                  />
                ) : null}
              </ListRow>
            ))}
          </List>
        ) : null}
      </Section>
      <CreatedTokenDialog token={createdToken} onClose={() => setCreatedToken(null)} />
    </div>
  );
}

function CreateTokenCard({ onCreated }: { readonly onCreated: (token: string) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ReadonlySet<TokenScope>>(new Set<TokenScope>(["read"]));
  const [expiresInDays, setExpiresInDays] = useState("");
  const [errors, setErrors] = useState<{
    readonly name?: string;
    readonly scopes?: string;
    readonly expiresInDays?: string;
  }>({});
  const create = useAction({
    action: (data: { name: string; scopes: TokenScope[]; expiresInDays: number | null }) =>
      createApiTokenFn({ data }),
    successMessage: "Token criado",
    invalidate: [["api-tokens"]],
    onSuccess: (result) => {
      setName("");
      setScopes(new Set<TokenScope>(["read"]));
      setExpiresInDays("");
      onCreated(result.token);
    },
  });
  const toggleScope = (scope: TokenScope, checked: boolean) => {
    setScopes((current) =>
      checked ? current.union(new Set([scope])) : current.difference(new Set([scope])),
    );
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedDays = expiresInDays.trim();
    const days = trimmedDays === "" ? null : Number(trimmedDays);
    const nextErrors = {
      ...(name.trim() === "" ? { name: "Informe um nome" } : {}),
      ...(scopes.size === 0 ? { scopes: "Escolha pelo menos um escopo" } : {}),
      ...(days != null && (Number.isInteger(days) === false || days < 1 || days > MAX_TOKEN_DAYS)
        ? { expiresInDays: `Informe de 1 a ${MAX_TOKEN_DAYS} dias inteiros, ou deixe em branco` }
        : {}),
    };
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    create.mutate({ name: name.trim(), scopes: [...scopes], expiresInDays: days });
  };
  return (
    <Section
      title="Novo token de API"
      description="Dê a cada cliente o menor escopo possível. O token é exibido uma única vez."
    >
      <Card className="p-5">
        <form className="max-w-lg space-y-4" onSubmit={submit}>
          <FormField id="token-name" label="Nome" errors={errors.name == null ? [] : [errors.name]}>
            {(props) => (
              <Input
                {...props}
                placeholder="claude-code-notebook"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </FormField>
          <fieldset className="space-y-2" aria-describedby="token-scopes-error">
            <legend className="text-sm font-medium">Escopos</legend>
            {(["read", "deploy"] as const).map((scope) => (
              <div key={scope} className="flex items-center gap-2">
                <Checkbox
                  id={`token-scope-${scope}`}
                  checked={scopes.has(scope)}
                  onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                />
                <Label htmlFor={`token-scope-${scope}`} className="font-normal">
                  {SCOPE_LABELS[scope]}
                </Label>
              </div>
            ))}
            <p
              id="token-scopes-error"
              aria-live="polite"
              className="text-xs font-medium text-destructive empty:hidden"
            >
              {errors.scopes ?? ""}
            </p>
          </fieldset>
          <FormField
            id="token-expiry"
            label="Validade em dias"
            hint="Deixe em branco para não expirar."
            errors={errors.expiresInDays == null ? [] : [errors.expiresInDays]}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={1}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
              />
            )}
          </FormField>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            Criar token
          </Button>
        </form>
      </Card>
    </Section>
  );
}

function CreatedTokenDialog({
  token,
  onClose,
}: {
  readonly token: string | null;
  readonly onClose: () => void;
}) {
  const command =
    token == null
      ? ""
      : `claude mcp add nelcota --env NELCOTA_MCP_TOKEN=${token} --env DATABASE_PATH=/caminho/para/data/nelcota.db -- bun run /caminho/para/o/repositorio/src/mcp/main.ts`;
  return (
    <Dialog open={token != null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {/* Shown only once: a stray click or Esc must not throw the token away. */}
      <DialogContent
        className="sm:max-w-2xl"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Copie o token agora</DialogTitle>
          <DialogDescription>
            Ele não será exibido novamente. Guarde-o em um gerenciador de senhas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="created-token">Token</Label>
            <div className="flex gap-2">
              <Input id="created-token" readOnly className="font-mono" value={token ?? ""} />
              <CopyButton text={token ?? ""} label="Copiar" />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Exemplo para o Claude Code</p>
            <pre className="overflow-x-auto rounded-lg bg-console p-3 font-mono text-xs break-all whitespace-pre-wrap text-console-foreground">
              {command}
            </pre>
            <div className="flex justify-end">
              <CopyButton text={command} label="Copiar comando" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Já copiei o token</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

type AuditEvent = Awaited<ReturnType<typeof listAuditEventsFn>>[number];

const ACTOR_TYPE_LABELS: Record<string, string> = {
  user: "Usuário",
  token: "Token",
  webhook: "Webhook",
  system: "Sistema",
};

function AuditTab() {
  const firstPage = useQuery({
    queryKey: ["audit"],
    queryFn: () => listAuditEventsFn({ data: {} }),
  });
  const [olderPages, setOlderPages] = useState<AuditEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const events = [...(firstPage.data ?? []), ...olderPages];

  const loadMore = async () => {
    const last = events.at(-1);
    if (last == null) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await listAuditEventsFn({ data: { before: last.createdAt } });
      setOlderPages((current) => [...current, ...page]);
      setExhausted(page.length === 0);
    } catch (error) {
      toast.error(toUserMessage(error, "Não foi possível carregar mais eventos."));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="space-y-10">
      <Section
        title="Eventos de auditoria"
        description="Ações administrativas e operacionais. Valores de secrets nunca são registrados."
      >
        {firstPage.isError ? (
          <ErrorState error={firstPage.error} onRetry={() => void firstPage.refetch()} />
        ) : null}
        {firstPage.data == null && firstPage.isError === false ? <ListSkeleton /> : null}
        {firstPage.data?.length === 0 ? (
          <EmptyState icon={ShieldIcon} title="Nenhum evento registrado" />
        ) : null}
        {events.length > 0 ? (
          <List>
            {events.map((event) => (
              <ListRow
                key={event.id}
                className="flex-col items-stretch gap-2 py-3 sm:flex-row sm:items-start"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium">
                      {AUDIT_ACTION_LABELS[event.action] ?? event.action}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {event.targetType}
                      {event.targetId == null ? "" : ` ${event.targetId.slice(-SHORT_ID_LENGTH)}`}
                    </span>
                  </p>
                  {event.details === "" || event.details === "{}" ? null : (
                    <details className="text-xs">
                      <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                        Ver detalhes
                      </summary>
                      <pre className="mt-1 font-mono break-all whitespace-pre-wrap text-muted-foreground">
                        {event.details}
                      </pre>
                    </details>
                  )}
                </div>
                <div className="space-y-1 text-xs sm:shrink-0 sm:text-right">
                  <p className="break-all">
                    <span className="text-muted-foreground">
                      {ACTOR_TYPE_LABELS[event.actorType] ?? event.actorType}:
                    </span>{" "}
                    {event.actorLabel}
                  </p>
                  <p className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                  </p>
                </div>
              </ListRow>
            ))}
          </List>
        ) : null}
        {events.length > 0 && exhausted === false ? (
          <div className="flex justify-center">
            <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              {loadingMore ? "Carregando…" : "Carregar mais"}
            </Button>
          </div>
        ) : null}
        {events.length > 0 && exhausted ? (
          <p className="text-center text-sm text-muted-foreground">Não há eventos mais antigos.</p>
        ) : null}
      </Section>
      <WebhookDeliveriesCard />
    </div>
  );
}

function WebhookDeliveriesCard() {
  const deliveries = useQuery({
    queryKey: ["webhook-deliveries"],
    queryFn: () => listWebhookDeliveriesFn(),
  });
  return (
    <Section
      title="Webhooks recebidos"
      description="Entregas do GitHub com assinatura válida, deduplicadas pelo identificador de entrega."
    >
      {deliveries.isError ? (
        <ErrorState error={deliveries.error} onRetry={() => void deliveries.refetch()} />
      ) : null}
      {deliveries.data == null && deliveries.isError === false ? <ListSkeleton rows={2} /> : null}
      {deliveries.data?.length === 0 ? (
        <EmptyState icon={WebhookIcon} title="Nenhum webhook recebido ainda" />
      ) : null}
      {deliveries.data != null && deliveries.data.length > 0 ? (
        <List>
          {deliveries.data.map((delivery) => (
            <ListRow
              key={delivery.id}
              accent={delivery.status === "accepted" ? "success" : "neutral"}
              className="items-start py-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm">
                  {delivery.repositoryFullName ?? "—"}
                  {delivery.ref == null ? (
                    ""
                  ) : (
                    <span className="text-muted-foreground">
                      {` (${delivery.ref.replace("refs/heads/", "")})`}
                    </span>
                  )}
                </p>
                <p className="font-mono text-xs text-faint">
                  {delivery.event} · {delivery.commitSha?.slice(0, SHORT_SHA_LENGTH) ?? "—"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                <StatusPill
                  tone={delivery.status === "accepted" ? "success" : "neutral"}
                  label={
                    delivery.status === "accepted"
                      ? pluralize(delivery.deploymentIds.length, "deploy", "deploys")
                      : "Ignorado"
                  }
                />
                <span className="text-xs text-muted-foreground">
                  {WEBHOOK_REASON_LABELS[delivery.reason] ?? delivery.reason}
                </span>
                <span className="text-xs whitespace-nowrap text-faint">
                  {formatDateTime(delivery.receivedAt)}
                </span>
              </div>
            </ListRow>
          ))}
        </List>
      ) : null}
    </Section>
  );
}
