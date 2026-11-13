import { useMutation } from "@tanstack/react-query";

import { toUserMessage } from "@/web/components/layout/error-message";
import { Button } from "@/web/components/ui/button";
import { verifyDomainHttpsFn } from "@/web/functions/domains/proxy-logs.functions";

export type HttpsCheck = Awaited<ReturnType<typeof verifyDomainHttpsFn>>;

const MESSAGES = {
  certificate: "O certificado ainda não passou na validação.",
  dns: "O painel ainda não conseguiu resolver o domínio no DNS.",
  timeout: "O endereço demorou demais para responder à checagem.",
  connection: "O painel ainda não conseguiu se conectar ao endereço por HTTPS.",
  "server-error": "O certificado foi aceito, mas o app respondeu com erro de servidor.",
  private: "O endereço só pode ser verificado pela rede privada.",
} as const satisfies Record<Exclude<HttpsCheck["status"], "ready">, string>;

/** Verifies the current HTTPS response while preserving the historical proxy errors. */
export function VerifyDomainHttps({
  projectId,
  hostname,
  onChecked,
  activeCheckAt,
}: {
  readonly projectId: string;
  readonly hostname: string;
  readonly onChecked: (result: HttpsCheck) => void;
  readonly activeCheckAt: string | undefined;
}) {
  const check = useMutation({
    mutationFn: () => verifyDomainHttpsFn({ data: { projectId, hostname } }),
    onSuccess: onChecked,
  });
  const result = check.data;
  const message =
    result != null && result.checkedAt === activeCheckAt && result.status !== "ready"
      ? MESSAGES[result.status]
      : "";
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full sm:w-auto"
        aria-disabled={check.isPending}
        onClick={() => {
          if (check.isPending === false) {
            check.mutate();
          }
        }}
      >
        {check.isPending ? "Verificando HTTPS…" : "Verificar HTTPS agora"}
      </Button>
      <p role="status" className="empty:sr-only">
        {check.isError
          ? toUserMessage(check.error, "Não foi possível verificar o HTTPS. Tente novamente.")
          : message}
      </p>
    </div>
  );
}
