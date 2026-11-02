import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/web/components/shell/auth-client";

/** Where the setup is: asking the password, showing the key, or showing the recovery codes. */
type TwoFactorStep =
  | { readonly kind: "password" }
  | { readonly kind: "setup"; readonly totpUri: string; readonly backupCodes: readonly string[] }
  | { readonly kind: "codes"; readonly backupCodes: readonly string[] };

type AuthResult = { readonly error: { readonly status: number } | null } | null;

const BAD_REQUEST = 400;
const TOO_MANY_REQUESTS = 429;

function failureMessage(result: AuthResult, badRequestMessage: string): string {
  if (result == null) {
    return "Não foi possível conectar ao servidor. Tente novamente.";
  }
  if (result.error?.status === TOO_MANY_REQUESTS) {
    return "Muitas tentativas. Aguarde um minuto e tente novamente.";
  }
  if (result.error?.status === BAD_REQUEST) {
    return badRequestMessage;
  }
  return "Não foi possível concluir. Tente novamente.";
}

async function settle<T>(request: Promise<T>): Promise<T | null> {
  return await request.catch((error: unknown) => {
    console.error("two-factor request failed", error);
    return null;
  });
}

/** Turns two-factor authentication on (password, then a code) or off (password). */
export function useTwoFactor(onFinished: () => void) {
  const router = useRouter();
  const [step, setStep] = useState<TwoFactorStep>({ kind: "password" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setPending(true);
    setError(null);
    await work();
    setPending(false);
  };
  const enable = async (password: string) =>
    await run(async () => {
      const result = await settle(authClient.twoFactor.enable({ password }));
      if (result?.data == null || "totpURI" in result.data === false) {
        setError(failureMessage(result, "Senha incorreta."));
        return;
      }
      setStep({
        kind: "setup",
        totpUri: result.data.totpURI,
        backupCodes: result.data.backupCodes,
      });
    });
  const confirm = async (code: string, backupCodes: readonly string[]) =>
    await run(async () => {
      const result = await settle(authClient.twoFactor.verifyTotp({ code: code.trim() }));
      if (result == null || result.error != null) {
        setError(failureMessage(result, "Código inválido. Confira o horário do celular."));
        return;
      }
      // The session refreshes only when the codes are dismissed: refreshing now could close a
      // screen that exists only until two-factor authentication is on.
      setStep({ kind: "codes", backupCodes });
    });
  const finish = async () => {
    await router.invalidate();
    onFinished();
  };
  const disable = async (password: string) =>
    await run(async () => {
      const result = await settle(authClient.twoFactor.disable({ password }));
      if (result == null || result.error != null) {
        setError(failureMessage(result, "Senha incorreta."));
        return;
      }
      toast.success("Verificação em duas etapas desativada");
      await finish();
    });
  return { step, error, pending, enable, confirm, disable, finish };
}
