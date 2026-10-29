import { useRouter } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { firstAdminSchema } from "@/shared/schemas/user.schema";
import { authClient } from "@/web/components/shell/auth-client";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { createFirstAdminFn } from "@/web/functions/session.functions";

const ERROR_ID = "first-admin-error";

function useCreateFirstAdmin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (fields: { name: string; email: string; password: string }) => {
    const parsed = firstAdminSchema.safeParse(fields);
    if (parsed.success === false) {
      setError(parsed.error.issues[0]?.message ?? "Confira os campos.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createFirstAdminFn({ data: parsed.data });
      await authClient.signIn.email({ email: parsed.data.email, password: parsed.data.password });
      await router.navigate({ to: "/" });
    } catch (createError: unknown) {
      console.error("first admin creation failed", createError);
      setSubmitting(false);
      setError(
        createError instanceof Error ? createError.message : "Não foi possível criar a conta.",
      );
    }
  };
  return { error, submitting, submit };
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
  const { error, submitting, submit } = useCreateFirstAdmin();
  const shared = { errorId: error == null ? undefined : ERROR_ID };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(fields);
  };

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
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
      <FormFooter error={error} submitting={submitting} />
    </form>
  );
}
