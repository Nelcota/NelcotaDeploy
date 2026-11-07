import { useRouter } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";

import { firstAdminSchema } from "@/shared/schemas/user.schema";
import { toUserMessage } from "@/web/components/layout/error-message";
import { authClient } from "@/web/components/shell/auth-client";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { createFirstAdminFn } from "@/web/functions/session.functions";

import { finishFirstAdminSetup } from "./first-admin-setup";

const ERROR_ID = "first-admin-error";

function useCreateFirstAdmin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(false);
  const inFlight = useRef(false);

  const submit = async (fields: { name: string; email: string; password: string }) => {
    if (inFlight.current || created) {
      return;
    }
    const parsed = firstAdminSchema.safeParse(fields);
    if (parsed.success === false) {
      setError(parsed.error.issues[0]?.message ?? "Confira os campos.");
      return;
    }
    setSubmitting(true);
    inFlight.current = true;
    setError(null);
    let accountCreated = false;
    try {
      const result = await finishFirstAdminSetup(parsed.data, {
        createAccount: (account) => createFirstAdminFn({ data: account }),
        signIn: (account) =>
          authClient.signIn.email({ email: account.email, password: account.password }),
      });
      accountCreated = true;
      if (result === "created") {
        setCreated(true);
        return;
      }
      await router.navigate({ to: "/" });
    } catch (createError: unknown) {
      console.error("First admin setup failed", createError);
      if (accountCreated) {
        setCreated(true);
        return;
      }
      setError(toUserMessage(createError, "Não foi possível criar a conta."));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };
  return { error, submitting, submit, created };
}

function TextField({
  id,
  label,
  value,
  onChange,
  errorId,
  ...inputProps
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Id of the error message, present only while there is an error. */
  readonly errorId: string | undefined;
  readonly type?: string;
  readonly autoComplete: string;
  readonly autoFocus?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-describedby={errorId}
        aria-invalid={errorId != null}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...inputProps}
      />
    </div>
  );
}

function FormFooter({
  error,
  submitting,
}: {
  readonly error: string | null;
  readonly submitting: boolean;
}) {
  return (
    <>
      {error == null ? null : (
        <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
        Criar conta e entrar
      </Button>
    </>
  );
}

/** Creates the first admin of a fresh panel and signs them in. */
export function FirstAdminForm() {
  const [fields, setFields] = useState({ name: "", email: "", password: "" });
  const bind = (key: keyof typeof fields) => ({
    value: fields[key],
    onChange: (value: string) => setFields((current) => ({ ...current, [key]: value })),
  });
  const { error, submitting, submit, created } = useCreateFirstAdmin();
  const shared = { errorId: error == null ? undefined : ERROR_ID };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(fields);
  };

  if (created) {
    return (
      <div role="status" className="space-y-4 rounded-xl bg-card p-5 ring-1 ring-border">
        <h2 className="text-lg font-semibold">Conta de administrador criada</h2>
        <p className="text-sm text-muted-foreground">
          Não foi possível concluir a entrada automática. Sua conta já está pronta: entre com o
          e-mail e a senha que você cadastrou.
        </p>
        <Button asChild className="w-full">
          <a href="/login">Ir para login</a>
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <fieldset disabled={submitting} className="space-y-4">
        <TextField
          id="admin-name"
          label="Seu nome"
          autoComplete="name"
          {...shared}
          {...bind("name")}
          autoFocus
        />
        <TextField
          id="admin-email"
          label="Seu e-mail"
          type="email"
          autoComplete="username"
          {...shared}
          {...bind("email")}
        />
        <TextField
          id="admin-password"
          label="Senha (mínimo de 12 caracteres)"
          type="password"
          autoComplete="new-password"
          {...shared}
          {...bind("password")}
        />
      </fieldset>
      <FormFooter error={error} submitting={submitting} />
    </form>
  );
}
