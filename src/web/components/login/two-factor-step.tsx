import { useRouter } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { authClient } from "@/web/components/shell/auth-client";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

import { safeRedirectTarget } from "./sign-in-redirect";

const TOO_MANY_REQUESTS = 429;
const ERROR_ID = "two-factor-error";

type CodeKind = "authenticator" | "recovery";

const LABELS: Readonly<Record<CodeKind, { readonly label: string; readonly switchTo: string }>> = {
  authenticator: {
    label: "Código do app autenticador",
    switchTo: "Usar um código de recuperação",
  },
  recovery: { label: "Código de recuperação", switchTo: "Usar o app autenticador" },
};

async function verifyCode(kind: CodeKind, code: string) {
  if (kind === "authenticator") {
    return await authClient.twoFactor.verifyTotp({ code });
  }
  return await authClient.twoFactor.verifyBackupCode({ code });
}

function useCodeVerification(redirectTarget: string | undefined) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (kind: CodeKind, code: string) => {
    if (code.trim() === "") {
      setError("Informe o código.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await verifyCode(kind, code.trim()).catch((verifyError: unknown) => {
      console.error("two-factor verification request failed", verifyError);
      return null;
    });
    if (result?.error != null || result == null) {
      setSubmitting(false);
      setError(codeErrorMessage(result?.error.status ?? null));
      return;
    }
    await router.navigate({ to: safeRedirectTarget(redirectTarget) });
  };
  return { error, submitting, submit };
}

function codeErrorMessage(status: number | null): string {
  if (status == null) {
    return "Não foi possível conectar ao servidor. Tente novamente.";
  }
  if (status === TOO_MANY_REQUESTS) {
    return "Muitas tentativas. Aguarde um minuto e tente novamente.";
  }
  return "Código inválido ou expirado.";
}

/**
 * Second step of signing in for accounts with two-factor authentication: a code from the
 * authenticator app, or one of the recovery codes.
 *
 * @param props - `redirectTarget`: path to open after signing in; only same-site paths are followed.
 */
export function TwoFactorStep({ redirectTarget }: { readonly redirectTarget: string | undefined }) {
  const [kind, setKind] = useState<CodeKind>("authenticator");
  const [code, setCode] = useState("");
  const { error, submitting, submit } = useCodeVerification(redirectTarget);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(kind, code);
  };
  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <p className="text-sm text-muted-foreground">
        Esta conta usa verificação em duas etapas. Abra o app autenticador e digite o código.
      </p>
      <div className="space-y-2">
        <Label htmlFor="two-factor-code">{LABELS[kind].label}</Label>
        <Input
          id="two-factor-code"
          inputMode={kind === "authenticator" ? "numeric" : "text"}
          autoComplete="one-time-code"
          className="font-mono tracking-widest"
          autoFocus
          aria-invalid={error != null}
          aria-describedby={error == null ? undefined : ERROR_ID}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>
      {error == null ? null : (
        <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
        Verificar
      </Button>
      <Button
        type="button"
        variant="link"
        className="w-full"
        onClick={() => {
          setKind(kind === "authenticator" ? "recovery" : "authenticator");
          setCode("");
        }}
      >
        {LABELS[kind].switchTo}
      </Button>
    </form>
  );
}
