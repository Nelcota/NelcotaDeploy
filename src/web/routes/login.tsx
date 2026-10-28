import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { z } from "zod";

import { authClient } from "@/web/components/auth-client";
import { NelcotaMark } from "@/web/components/brand-logo";
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
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-5 text-center">
          <NelcotaMark className="h-12 w-auto" />
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Entrar no Nelcota Deploy</h1>
            <p className="text-sm text-muted-foreground">Use a conta criada pelo administrador.</p>
          </div>
        </div>
        <form
          className="space-y-5 rounded-xl border bg-card p-6"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="voce@empresa.com"
              required
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
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error == null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={submitting || email.trim() === "" || password === ""}
          >
            {submitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            Entrar
          </Button>
        </form>
      </div>
    </main>
  );
}
