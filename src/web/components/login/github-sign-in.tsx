import { useState } from "react";

import { authClient } from "@/web/components/shell/auth-client";
import { Button } from "@/web/components/ui/button";

import { githubSignInErrorMessage, safeRedirectTarget } from "./sign-in-redirect";

const ERROR_ID = "github-sign-in-error";

/**
 * "Sign in with GitHub", for people whose panel account uses the e-mail verified on GitHub.
 *
 * @param props - `redirectTarget` after signing in and the `error` GitHub sign-in came back with.
 */
export function GitHubSignIn({
  redirectTarget,
  error,
}: {
  readonly redirectTarget: string | undefined;
  readonly error: string | undefined;
}) {
  const [starting, setStarting] = useState(false);
  const start = () => {
    setStarting(true);
    void authClient.signIn
      .social({
        provider: "github",
        callbackURL: safeRedirectTarget(redirectTarget),
        errorCallbackURL: "/login",
      })
      .catch((signInError: unknown) => {
        console.error("GitHub sign-in could not start", signInError);
        setStarting(false);
      });
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        ou
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        disabled={starting}
        aria-describedby={error == null ? undefined : ERROR_ID}
        onClick={start}
      >
        Entrar com GitHub
      </Button>
      {error == null ? null : (
        <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
          {githubSignInErrorMessage(error)}
        </p>
      )}
    </div>
  );
}
