import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { EyeIcon, EyeOffIcon, LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { z } from "zod";

import { useNow } from "@/web/components/clock/use-now";
import { authClient } from "@/web/components/shell/auth-client";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { getSessionFn } from "@/web/functions/session.functions";

const TOO_MANY_REQUESTS = 429;

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async () => {
    const user = await getSessionFn();
    if (user != null) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({ meta: [{ title: "Entrar · Nelcota Deploy" }] }),
  component: LoginPage,
});

/** Only same-site paths are followed after login, never full URLs. */
function safeRedirectTarget(target: string | undefined): string {
  if (target == null || target.startsWith("/") === false || target.startsWith("//")) {
    return "/";
  }
  return target;
}

function LoginPage() {
  const now = useNow();
  return (
    <div className="flex min-h-svh bg-background p-0 sm:p-6">
      <main className="flex flex-1 flex-col items-center bg-panel px-5 py-12 ring-1 ring-border/60 sm:rounded-3xl">
        <div className="flex w-full max-w-sm flex-1 flex-col justify-center gap-8">
          <LoginLogo />
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">Entrar no Nelcota Deploy</h1>
            <p className="text-base text-muted-foreground">
              Use a conta criada pelo administrador do painel.
            </p>
          </div>
          <LoginForm />
          <p className="text-center text-sm text-muted-foreground">
            Esqueceu a senha? Peça a um administrador para redefini-la.
          </p>
        </div>
        <footer className="pt-10 text-xs text-muted-foreground">
          © {now.getUTCFullYear()} Nelcota
        </footer>
      </main>
    </div>
  );
}

/** The wordmark exists in white and black; each theme shows the one with contrast. */
function LoginLogo() {
  return (
    <>
      <img
        src="/nelcota-logo-white.svg"
        alt="Nelcota"
        width={192}
        height={72}
        className="mx-auto hidden h-18 w-auto dark:block"
      />
      <img
        src="/nelcota-logo-black.svg"
        alt="Nelcota"
        width={192}
        height={72}
        className="mx-auto h-18 w-auto dark:hidden"
      />
    </>
  );
}

function signInErrorMessage(status: number): string {
  if (status === TOO_MANY_REQUESTS) {
    return "Muitas tentativas. Aguarde um minuto e tente novamente.";
  }
  return "E-mail ou senha inválidos.";
}

function useLogin() {
  const router = useRouter();
  const search = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (email: string, password: string) => {
    if (email.trim() === "" || password === "") {
      setError("Informe o e-mail e a senha.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await authClient.signIn
      .email({ email: email.trim().toLowerCase(), password })
      .catch((signInError: unknown) => {
        console.error("sign-in request failed", signInError);
        return null;
      });
    if (result == null) {
      setSubmitting(false);
      setError("Não foi possível conectar ao servidor. Tente novamente.");
      return;
    }
    if (result.error != null) {
      // The button stays busy on success: it is re-enabled only when the user must act again.
      setSubmitting(false);
      setError(signInErrorMessage(result.error.status));
      return;
    }
    await router.navigate({ to: safeRedirectTarget(search.redirect) });
  };
  return { error, submitting, submit };
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { error, submitting, submit } = useLogin();
  const errorId = error == null ? undefined : "login-error";

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(email, password);
  };

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Seu e-mail</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          placeholder="voce@empresa.com"
          required
          autoFocus
          aria-invalid={error != null}
          aria-describedby={errorId}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <PasswordField value={password} onChange={setPassword} errorId={errorId} />
      {error == null ? null : (
        <p id="login-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
        Entrar
      </Button>
    </form>
  );
}

function PasswordField({
  value,
  onChange,
  errorId,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Id of the error message, present only while there is an error. */
  readonly errorId: string | undefined;
}) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor="password">Senha</Label>
      <div className="relative">
        <Input
          id="password"
          type={passwordVisible ? "text" : "password"}
          className="pr-11"
          autoComplete="current-password"
          required
          aria-invalid={errorId != null}
          aria-describedby={errorId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={passwordVisible ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={passwordVisible}
          onClick={() => setPasswordVisible((visible) => visible === false)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {passwordVisible ? (
            <EyeOffIcon aria-hidden className="size-4" />
          ) : (
            <EyeIcon aria-hidden className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}
