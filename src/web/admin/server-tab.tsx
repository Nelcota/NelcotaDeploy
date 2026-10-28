import {
  ActivityIcon,
  ContainerIcon,
  CpuIcon,
  GaugeIcon,
  GlobeIcon,
  HardDriveIcon,
  HeartPulseIcon,
  LayersIcon,
  LockKeyholeIcon,
  type LucideIcon,
  MemoryStickIcon,
  NetworkIcon,
  RouteIcon,
  ServerIcon,
  TriangleAlertIcon,
  WebhookIcon,
} from "lucide-react";
import { type ReactNode } from "react";

import { formatBytes, formatRelativeTime, formatTimeAgo } from "@/shared/format";
import { CopyButton } from "@/web/components/copy-button";
import { Section, StatRow } from "@/web/components/layout";
import { ErrorState, ListSkeleton } from "@/web/components/states";
import { StatusPill } from "@/web/components/status-badge";
import { Input } from "@/web/components/ui/input";
import { usagePercent } from "@/web/components/usage-meter";

import { isUnreachableFromInternet } from "./public-url";
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

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon aria-hidden className="size-4 shrink-0" />
        {label}
      </dt>
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
        icon={ServerIcon}
        title="Servidor (VPS)"
        description={
          host == null
            ? "Nenhuma amostra coletada ainda."
            : `Última amostra ${formatRelativeTime(host.createdAt, now)}.`
        }
      >
        <StatRow
          stats={[
            {
              label: "CPU",
              icon: CpuIcon,
              value: formatPercent(cpuPercent),
              tone: usageTone(cpuPercent),
            },
            {
              label: "Memória",
              icon: MemoryStickIcon,
              value: formatPercent(memoryPercent),
              tone: usageTone(memoryPercent),
              detail:
                host == null
                  ? undefined
                  : `${formatBytes(host.memoryUsedBytes)} de ${formatBytes(host.memoryTotalBytes)}`,
            },
            {
              label: "Disco",
              icon: HardDriveIcon,
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
      <Section icon={ContainerIcon} title="Worker e Docker">
        <dl className="divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border/70">
          <InfoRow icon={ActivityIcon} label="Worker">
            {server.worker == null ? (
              <StatusPill tone="danger" label="Nunca conectou" />
            ) : (
              <StatusPill
                tone={server.worker.online ? "success" : "danger"}
                label={server.worker.online ? "Online" : "Offline"}
              />
            )}
          </InfoRow>
          <InfoRow icon={HeartPulseIcon} label="Último sinal do worker">
            {formatTimeAgo(server.worker?.lastSeenAt, now)}
          </InfoRow>
          <InfoRow icon={ContainerIcon} label="Docker">
            {server.worker?.dockerAvailable === true ? (
              (server.worker.dockerVersion ?? "Disponível")
            ) : (
              <StatusPill tone="danger" label="Indisponível" />
            )}
          </InfoRow>
          <InfoRow icon={NetworkIcon} label="Rede Docker">
            <span className="font-mono">{server.dockerNetwork}</span>
          </InfoRow>
          <InfoRow icon={RouteIcon} label="Traefik">
            <StatusPill
              tone={server.traefikEnabled ? "success" : "warning"}
              label={server.traefikEnabled ? "Ativado" : "Desativado"}
            />
          </InfoRow>
          <InfoRow icon={LayersIcon} label="Jobs simultâneos">
            {server.workerConcurrency}
          </InfoRow>
          <InfoRow icon={GaugeIcon} label="Coleta de métricas">
            a cada {server.metricsIntervalInSeconds} s, retenção de {server.metricsRetentionInHours}{" "}
            h
          </InfoRow>
          <InfoRow icon={GlobeIcon} label="Fuso dos agendamentos">
            {server.scheduleTimeZone}
          </InfoRow>
          <InfoRow icon={LockKeyholeIcon} label="Chave de criptografia">
            <StatusPill
              tone={server.encryptionConfigured ? "success" : "danger"}
              label={server.encryptionConfigured ? "Configurada" : "Ausente"}
            />
          </InfoRow>
        </dl>
      </Section>
      <Section
        icon={WebhookIcon}
        title="Webhook do GitHub"
        description="Deploy automático a cada push na branch configurada de projetos com deploy automático ativo."
      >
        <div className="flex max-w-2xl gap-2">
          <Input
            readOnly
            aria-label="URL do webhook"
            className="font-mono"
            value={server.webhookUrl}
          />
          <CopyButton text={server.webhookUrl} label="Copiar" />
        </div>
        {isUnreachableFromInternet(server.webhookUrl) ? (
          <p className="flex items-start gap-1.5 text-sm text-warning">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            Esta URL não é acessível pelo GitHub. Defina PUBLIC_URL com o endereço público do
            painel.
          </p>
        ) : null}
        <div>
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
