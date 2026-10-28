import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { LoaderCircleIcon, RocketIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { z } from "zod";

import { authClient } from "@/web/components/auth-client";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
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
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <RocketIcon aria-hidden className="size-5" />
          </span>
          <div className="space-y-1">
            <CardTitle className="text-xl">Entrar no Nelcota Deploy</CardTitle>
            <CardDescription>
              Use a conta criada pelo administrador da sua organização.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
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
            <p role="alert" aria-live="assertive" className="min-h-5 text-sm text-destructive">
              {error ?? ""}
            </p>
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || email.trim() === "" || password === ""}
            >
              {submitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              Entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
