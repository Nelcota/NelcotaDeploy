import { type ReactNode } from "react";

import { formatBytes, formatRelativeTime } from "@/shared/format";
import { CopyButton } from "@/web/components/copy-button";
import { Section, StatRow } from "@/web/components/layout";
import { ErrorState, ListSkeleton } from "@/web/components/states";
import { StatusPill } from "@/web/components/status-badge";
import { usagePercent } from "@/web/components/usage-meter";

import { useSettings } from "./use-settings";

/** Usage at or above these percentages is shown as a warning or a problem. */
const USAGE_WARNING_PERCENT = 75;
const USAGE_DANGER_PERCENT = 90;

function usageTone(percent: number | null): "default" | "warning" | "danger" {
  if (percent == null || percent < USAGE_WARNING_PERCENT) {
    return "default";
  }
  return percent >= USAGE_DANGER_PERCENT ? "danger" : "warning";
}

function formatPercent(percent: number | null): string {
  return percent == null ? "—" : `${Math.round(percent)}%`;
}

function InfoRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

/** Host resources, worker state and the GitHub webhook setup. */
export function ServerTab() {
  const settings = useSettings();
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  if (settings.data == null) {
    return <ListSkeleton rows={4} />;
  }
  const { server } = settings.data;
  const host = server.hostSample;
  const now = new Date();
  const cpuPercent = host?.cpuPercent ?? null;
  const memoryPercent = usagePercent(host?.memoryUsedBytes, host?.memoryTotalBytes);
  const diskPercent = usagePercent(host?.diskUsedBytes, host?.diskTotalBytes);
  return (
    <div className="space-y-10">
      <Section
        title="Servidor (VPS)"
        description={
          host == null
            ? "Nenhuma amostra coletada ainda."
            : `Última amostra ${formatRelativeTime(host.createdAt, now)}.`
        }
      >
        <StatRow
          stats={[
            { label: "CPU", value: formatPercent(cpuPercent), tone: usageTone(cpuPercent) },
            {
              label: "Memória",
              value: formatPercent(memoryPercent),
              tone: usageTone(memoryPercent),
              detail:
                host == null
                  ? undefined
                  : `${formatBytes(host.memoryUsedBytes)} de ${formatBytes(host.memoryTotalBytes)}`,
            },
            {
              label: "Disco",
              value: formatPercent(diskPercent),
              tone: usageTone(diskPercent),
              detail:
                host == null
                  ? undefined
                  : `${formatBytes(host.diskUsedBytes)} de ${formatBytes(host.diskTotalBytes)}`,
            },
          ]}
        />
      </Section>
      <Section title="Worker e Docker">
        <dl className="divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border/70">
          <InfoRow label="Worker">
            {server.worker == null ? (
              <StatusPill tone="danger" label="Nunca conectou" />
            ) : (
              <StatusPill
                tone={server.worker.online ? "success" : "danger"}
                label={server.worker.online ? "Online" : "Offline"}
              />
            )}
          </InfoRow>
          <InfoRow label="Último sinal do worker">
            {formatRelativeTime(server.worker?.lastSeenAt, now)}
          </InfoRow>
          <InfoRow label="Docker">
            {server.worker?.dockerAvailable === true
              ? (server.worker.dockerVersion ?? "Disponível")
              : "Indisponível"}
          </InfoRow>
          <InfoRow label="Rede Docker">
            <span className="font-mono">{server.dockerNetwork}</span>
          </InfoRow>
          <InfoRow label="Traefik">{server.traefikEnabled ? "Ativado" : "Desativado"}</InfoRow>
          <InfoRow label="Jobs simultâneos">{server.workerConcurrency}</InfoRow>
          <InfoRow label="Coleta de métricas">
            a cada {server.metricsIntervalInSeconds} s, retenção de {server.metricsRetentionInHours}{" "}
            h
          </InfoRow>
          <InfoRow label="Fuso dos agendamentos">{server.scheduleTimeZone}</InfoRow>
          <InfoRow label="Chave de criptografia">
            <StatusPill
              tone={server.encryptionConfigured ? "success" : "danger"}
              label={server.encryptionConfigured ? "Configurada" : "Ausente"}
            />
          </InfoRow>
        </dl>
      </Section>
      <Section
        title="Webhook do GitHub"
        description="Deploy automático a cada push na branch configurada de projetos com deploy automático ativo."
      >
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-secondary px-2 py-1 font-mono text-sm break-all ring-1 ring-border ring-inset">
            {server.webhookUrl}
          </code>
          <CopyButton text={server.webhookUrl} label="Copiar URL" />
          <StatusPill
            tone={server.webhookConfigured ? "success" : "warning"}
            label={
              server.webhookConfigured ? "Segredo configurado" : "GITHUB_WEBHOOK_SECRET ausente"
            }
          />
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>No repositório, abra Settings → Webhooks → Add webhook.</li>
          <li>Payload URL: a URL acima. Content type: application/json.</li>
          <li>Secret: o mesmo valor de GITHUB_WEBHOOK_SECRET do servidor.</li>
          <li>Eventos: “Just the push event”.</li>
        </ol>
      </Section>
    </div>
  );
}
