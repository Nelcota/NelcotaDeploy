import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { z } from "zod";

import { authClient } from "@/web/components/auth-client";
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
  const router = useRouter();
  const search = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (email.trim() === "" || password === "") {
      setError("Informe o e-mail e a senha.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
    setSubmitting(false);
    if (result.error != null) {
      setError(
        result.error.status === TOO_MANY_REQUESTS
          ? "Muitas tentativas. Aguarde um minuto e tente novamente."
          : "E-mail ou senha inválidos.",
      );
      return;
    }
    await router.navigate({ to: safeRedirectTarget(search.redirect) });
  };

  return (
    <div className="flex min-h-svh bg-background p-0 sm:p-6">
      <main className="flex flex-1 flex-col items-center bg-panel bg-gradient-to-b from-well/40 to-transparent px-5 py-12 ring-1 ring-border/60 sm:rounded-3xl">
        <div className="flex w-full max-w-sm flex-1 flex-col justify-center gap-8">
          {/* The wordmark exists in white and black; each theme shows the one with contrast. */}
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
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">Entrar no Deploy</h1>
            <p className="text-base text-muted-foreground">
              Use a conta criada pelo administrador do painel.
            </p>
          </div>
          <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Seu e-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="voce@empresa.com"
                required
                aria-describedby={error == null ? undefined : "login-error"}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                aria-describedby={error == null ? undefined : "login-error"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error == null ? null : (
              <p id="login-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full rounded-lg" disabled={submitting}>
              {submitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              Entrar
            </Button>
          </form>
          <p className="text-center text-sm text-faint">
            Esqueceu a senha? Peça a um administrador para redefini-la.
          </p>
        </div>
        <footer className="pt-10 text-xs text-faint">
          © {new Date().getUTCFullYear()} Nelcota
        </footer>
      </main>
    </div>
  );
}
