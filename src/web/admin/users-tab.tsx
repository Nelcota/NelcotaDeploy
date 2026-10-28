import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { LoaderCircleIcon, PlusIcon, UsersIcon, WandSparklesIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { formatDateTime } from "@/shared/format";
import { type Role, ROLES } from "@/shared/roles";
import { newUserSchema, PASSWORD_MIN_LENGTH, passwordSchema } from "@/shared/user.schema";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { CopyButton } from "@/web/components/copy-button";
import { FormField } from "@/web/components/form-field";
import { ROLE_LABELS } from "@/web/components/labels";
import { List, ListRow, Section } from "@/web/components/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { StatusPill } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
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
import { useAction } from "@/web/components/use-action";
import { UserAvatar } from "@/web/components/user-avatar";
import {
  createUserFn,
  listUsersFn,
  resetUserPasswordFn,
  setUserDisabledFn,
  updateUserRoleFn,
} from "@/web/functions/settings.functions";

const GENERATED_PASSWORD_BYTES = 18;

/** Builds a strong random password in the browser with the Web Crypto API. */
function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GENERATED_PASSWORD_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** Accounts of the panel: roles, activation and passwords. */
export function UsersTab() {
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
              {/* On phones the person fills the first line and the controls wrap below. */}
              <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] space-y-0.5 md:basis-auto">
                <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span className="truncate">{user.name}</span>
                  {user.id === currentUser.id ? (
                    <span className="shrink-0 font-normal text-muted-foreground">(você)</span>
                  ) : null}
                  {user.disabled ? <StatusPill tone="neutral" label="Desativado" /> : null}
                </p>
                <p className="truncate text-sm text-muted-foreground" title={user.email}>
                  {user.email}
                </p>
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
