import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { useNow } from "@/web/components/clock/use-now";
import { FirstAdminForm } from "@/web/components/login/first-admin-form";
import { GitHubSignIn } from "@/web/components/login/github-sign-in";
import { LoginForm } from "@/web/components/login/login-form";
import { getLoginOptionsFn, getSessionFn } from "@/web/functions/session.functions";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({
    redirect: z.string().optional(),
    // Set by Better Auth when GitHub sign-in fails.
    error: z.string().max(100).optional(),
  }),
  beforeLoad: async () => {
    const user = await getSessionFn();
    if (user != null) {
      throw redirect({ to: "/" });
    }
  },
  loader: async () => await getLoginOptionsFn(),
  head: () => ({ meta: [{ title: "Entrar · Nelcota Deploy" }] }),
  component: LoginPage,
});

function LoginPage() {
  const now = useNow();
  const { needsFirstAdmin, githubLogin } = Route.useLoaderData();
  const search = Route.useSearch();
  return (
    <div className="flex min-h-svh bg-background p-0 sm:p-6">
      <main className="flex flex-1 flex-col items-center bg-panel px-5 py-12 ring-1 ring-border/60 sm:rounded-3xl">
        <div className="flex w-full max-w-sm flex-1 flex-col justify-center gap-8">
          <LoginLogo />
          {needsFirstAdmin ? <FirstAdminIntro /> : <SignInIntro />}
          {needsFirstAdmin ? <FirstAdminForm /> : <LoginForm redirectTarget={search.redirect} />}
          {githubLogin && needsFirstAdmin === false ? (
            <GitHubSignIn redirectTarget={search.redirect} error={search.error} />
          ) : null}
          {needsFirstAdmin ? null : (
            <p className="text-center text-sm text-muted-foreground">
              Esqueceu a senha? Peça a um administrador para redefini-la.
            </p>
          )}
        </div>
        <footer className="pt-10 text-xs text-muted-foreground">
          © {now.getUTCFullYear()} Nelcota
        </footer>
      </main>
    </div>
  );
}

function SignInIntro() {
  return (
    <div className="space-y-2 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Entrar no Nelcota Deploy</h1>
      <p className="text-base text-muted-foreground">
        Use a conta criada pelo administrador do painel.
      </p>
    </div>
  );
}

function FirstAdminIntro() {
  return (
    <div className="space-y-2 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Criar o administrador</h1>
      <p className="text-base text-muted-foreground">
        Esta é a primeira conta do painel. Ela poderá convidar as demais.
      </p>
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
