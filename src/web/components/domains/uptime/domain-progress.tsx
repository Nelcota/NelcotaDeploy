import { CircleCheckIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { formatDateTime } from "@/shared/format";
import { httpsRecoveryAt } from "@/shared/https";
import { useNow } from "@/web/components/clock/use-now";
import { OpenAppButton } from "@/web/components/projects/project-actions";

import { type DomainItem, certificateHistoryId, domainUrl } from "../domains";
import { CertificateProgress } from "./certificate-progress";
import { type domainProgress, manualHttpsIsCurrent } from "./domain-access";
import { ProxyCertificateLogs } from "./proxy-certificate-logs";
import type { DomainUptime } from "./uptime-state";
import type { HttpsCheck } from "./verify-domain-https";

type Progress = ReturnType<typeof domainProgress>;

const MESSAGES: Record<Progress, { readonly title: string; readonly guidance: string }> = {
  pending: {
    title: "Domínio salvo",
    guidance: "Aplique as alterações para ativar o endereço no servidor.",
  },
  checking: {
    title: "Verificando acesso",
    guidance: "O status atualiza automaticamente após a próxima checagem.",
  },
  dns: {
    title: "Problema no DNS",
    guidance:
      "Confira o registro no provedor. Assim que o DNS propagar, o painel atualiza o status.",
  },
  "waiting-for-http": {
    title: "DNS confirmado. Verificando acesso",
    guidance: "O painel aguarda uma resposta do app e atualiza esta tela automaticamente.",
  },
  "waiting-for-https": {
    title: "Aguardando certificado HTTPS",
    guidance:
      "A emissão é automática. Pode deixar esta tela aberta. O botão Abrir app aparece assim que o acesso seguro for confirmado.",
  },
  certificate: {
    title: "Problema no HTTPS",
    guidance:
      "Confira o destino do DNS. Se estiver correto, peça ao administrador para verificar a porta 80 para emissão, a 443 para acesso e os erros nos logs do proxy.",
  },
  unreachable: {
    title: "Falha de acesso",
    guidance: "Confira se o app está rodando e se o servidor aceita conexões.",
  },
  private: {
    title: "Endereço privado",
    guidance: "Teste o endereço a partir da rede em que ele é acessível.",
  },
  ready: {
    title: "App pronto para abrir",
    guidance: "O endereço respondeu à última checagem do painel.",
  },
};

/** Shows the current stage without moving focus when the checks update. */
export function DomainProgress({
  domain,
  progress: scheduledProgress,
  certificateSince,
  recentChecks,
  deploymentId,
  projectId,
  proxyLogsAvailable,
  openHistory = false,
  pendingMessage,
  children,
}: {
  readonly domain: DomainItem;
  readonly progress: Progress;
  readonly certificateSince: string | null;
  readonly recentChecks: DomainUptime["recent"] | undefined;
  readonly deploymentId: string | null;
  readonly projectId: string;
  readonly proxyLogsAvailable: boolean;
  readonly openHistory?: boolean;
  readonly pendingMessage?: string | undefined;
  readonly children?: ReactNode;
}) {
  const now = useNow();
  const [manualCheck, setManualCheck] = useState<
    (HttpsCheck & { readonly recovered: boolean }) | null
  >(null);
  const latestCheckAt = recentChecks?.at(-1)?.checkedAt ?? null;
  const currentManualCheck =
    manualCheck?.deploymentId === deploymentId &&
    scheduledProgress !== "pending" &&
    manualHttpsIsCurrent({ checkedAt: manualCheck.checkedAt, latestCheckAt, now })
      ? manualCheck
      : null;
  const progress =
    currentManualCheck == null ? scheduledProgress : MANUAL_PROGRESS[currentManualCheck.status];
  const { title, guidance } = MESSAGES[progress];
  const ready = progress === "ready";
  const recoveredAt = ready && domain.httpsEnabled ? httpsRecoveryAt(recentChecks ?? []) : null;
  const recovered = recoveredAt != null || currentManualCheck?.recovered === true;
  const verifiedAt = recoveredAt ?? currentManualCheck?.checkedAt ?? latestCheckAt;
  let heading = title;
  if (ready && domain.httpsEnabled) {
    heading = recovered ? "Problema de HTTPS resolvido" : "HTTPS funcionando";
  }

  const description =
    ready && domain.httpsEnabled ? "O endereço respondeu com um certificado válido." : guidance;
  const diagnosingCertificate = progress === "waiting-for-https" || progress === "certificate";
  return (
    <div
      className={
        ready ? "space-y-3 rounded-lg bg-success/8 p-3 ring-1 ring-success/25" : "space-y-3"
      }
    >
      <div className="space-y-1 text-sm">
        <div role="status" className="space-y-1">
          <p className="flex items-center gap-2 font-semibold">
            {ready ? (
              <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-success" />
            ) : null}
            {heading}
          </p>
          <p className="text-muted-foreground">
            {progress === "pending" ? (pendingMessage ?? description) : description}
          </p>
        </div>
        {ready && domain.httpsEnabled && verifiedAt != null ? (
          <p className="text-xs text-muted-foreground">
            {recovered ? "Recuperação verificada em" : "Verificado em"}{" "}
            <time dateTime={verifiedAt}>{formatDateTime(verifiedAt)}</time>
          </p>
        ) : null}
      </div>
      <div className="grid gap-2 empty:hidden sm:flex sm:flex-wrap">
        {ready || progress === "private" ? (
          <OpenAppButton url={domainUrl(domain)} prominent={ready} />
        ) : null}
        {children}
      </div>
      {diagnosingCertificate ? (
        <CertificateProgress
          key={domain.hostname}
          failed={progress === "certificate"}
          firstFailureAt={certificateSince}
        />
      ) : null}
      {domain.httpsEnabled && proxyLogsAvailable ? (
        <ProxyCertificateLogs
          key={`${projectId}:${domain.hostname}:${openHistory}`}
          projectId={projectId}
          hostname={domain.hostname}
          visible={diagnosingCertificate || ready || openHistory}
          initiallyOpen={openHistory}
          healthy={ready}
          activeCheckAt={currentManualCheck?.checkedAt}
          onChecked={(check) =>
            setManualCheck((previous) => ({
              ...check,
              recovered:
                check.status === "ready" &&
                (scheduledProgress === "certificate" ||
                  certificateSince != null ||
                  (previous?.deploymentId === check.deploymentId &&
                    (previous.status === "certificate" || previous.recovered))),
            }))
          }
        />
      ) : null}
      {(diagnosingCertificate || openHistory) && proxyLogsAvailable === false ? (
        <p
          id={certificateHistoryId(domain.hostname)}
          tabIndex={openHistory ? -1 : undefined}
          className="scroll-mt-4 rounded-sm text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Consulte o histórico do certificado nos logs do seu provedor de HTTPS.
        </p>
      ) : null}
    </div>
  );
}

const MANUAL_PROGRESS = {
  ready: "ready",
  private: "private",
  dns: "dns",
  certificate: "certificate",
  connection: "unreachable",
  timeout: "unreachable",
  "server-error": "unreachable",
} as const satisfies Record<HttpsCheck["status"], Progress>;
