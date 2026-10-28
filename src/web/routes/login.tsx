import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { z } from "zod";

import { authClient } from "@/web/components/auth-client";
import { NelcotaLogo, NelcotaMark } from "@/web/components/brand-logo";
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
    <main className="grid min-h-svh bg-background lg:grid-cols-[1.05fr_1fr]">
      <section
        aria-hidden
        className="relative hidden overflow-hidden border-r border-sidebar-border bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-14"
      >
        <div className="pointer-events-none absolute -top-40 -left-32 size-[34rem] rounded-full bg-primary/25 blur-[120px]" />
        <div className="pointer-events-none absolute -right-24 bottom-0 size-[26rem] rounded-full bg-brand/15 blur-[110px]" />
        <NelcotaLogo className="relative h-9 w-auto self-start text-foreground" />
        <div className="relative max-w-lg space-y-5">
          <NelcotaMark className="h-16 w-auto self-start" />
          <h2 className="text-[2.4rem] leading-[1.1] font-bold tracking-tight">
            Deploys da sua organização, do push ao ar.
          </h2>
          <p className="text-[1.05rem] leading-relaxed text-muted-foreground">
            Build com Docker, logs em tempo real, domínios com HTTPS e tasks agendadas — tudo em um
            painel só.
          </p>
        </div>
        <p className="relative text-[0.85rem] text-muted-foreground">
          Nelcota Deploy · uso interno
        </p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-6">
            <NelcotaLogo className="h-8 w-auto text-foreground lg:hidden" />
            <div className="space-y-2">
              <h1 className="text-[2rem] leading-tight font-bold tracking-tight">Entrar</h1>
              <p className="text-[1rem] leading-relaxed text-muted-foreground">
                Use a conta criada pelo administrador da sua organização.
              </p>
            </div>
          </div>
          <form className="space-y-5" onSubmit={(event) => void submit(event)} noValidate>
            <div className="space-y-2.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="voce@empresa.com"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-12"
              />
            </div>
            <div className="space-y-2.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12"
              />
            </div>
            <p
              role="alert"
              aria-live="assertive"
              className="min-h-5 text-[0.92rem] font-medium text-destructive"
            >
              {error ?? ""}
            </p>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting || email.trim() === "" || password === ""}
            >
              {submitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              Entrar no painel
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
