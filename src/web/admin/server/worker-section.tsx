import {
  ActivityIcon,
  ContainerIcon,
  DatabaseIcon,
  GaugeIcon,
  GlobeIcon,
  HeartPulseIcon,
  LayersIcon,
  LockKeyholeIcon,
  type LucideIcon,
  NetworkIcon,
  RouteIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { formatTimeAgo } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";
import { Section } from "@/web/components/layout/layout";
import { StatusPill } from "@/web/components/layout/status-badge";

import type { ServerData } from "./server-data";
import { ToggleStatusPill } from "./toggle-status-pill";

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

function WorkerRows({ worker }: { readonly worker: ServerData["worker"] }) {
  const now = useNow();
  return (
    <>
      <InfoRow icon={ActivityIcon} label="Worker">
        {worker == null ? (
          <StatusPill tone="danger" label="Nunca conectou" />
        ) : (
          <ToggleStatusPill
            on={worker.online}
            onLabel="Online"
            offLabel="Offline"
            offTone="danger"
          />
        )}
      </InfoRow>
      <InfoRow icon={HeartPulseIcon} label="Último sinal do worker">
        {formatTimeAgo(worker?.lastSeenAt, now)}
      </InfoRow>
      <InfoRow icon={ContainerIcon} label="Servidores de aplicações">
        {worker?.dockerAvailable === true ? (
          <StatusPill tone="success" label="Prontos" />
        ) : (
          <StatusPill tone="danger" label="Com problema" />
        )}
      </InfoRow>
    </>
  );
}

function ConfigurationRows({ server }: { readonly server: ServerData }) {
  return (
    <>
      <InfoRow icon={NetworkIcon} label="Rede Docker">
        <span className="font-mono">{server.dockerNetwork}</span>
      </InfoRow>
      <InfoRow icon={RouteIcon} label="Traefik">
        <ToggleStatusPill
          on={server.traefikEnabled}
          onLabel="Ativado"
          offLabel="Desativado"
          offTone="warning"
        />
      </InfoRow>
      <InfoRow icon={LayersIcon} label="Jobs simultâneos">
        {server.workerConcurrency}
      </InfoRow>
      <InfoRow icon={GaugeIcon} label="Coleta de métricas">
        a cada {server.metricsIntervalInSeconds} s, retenção de {server.metricsRetentionInHours} h
      </InfoRow>
      <InfoRow icon={GlobeIcon} label="Fuso dos agendamentos">
        {server.scheduleTimeZone}
      </InfoRow>
      <InfoRow icon={DatabaseIcon} label="Backup do banco">
        <BackupStatus backup={server.backup} />
      </InfoRow>
      <InfoRow icon={LockKeyholeIcon} label="Chave de criptografia">
        <ToggleStatusPill
          on={server.encryptionConfigured}
          onLabel="Configurada"
          offLabel="Ausente"
          offTone="danger"
        />
      </InfoRow>
    </>
  );
}

/** When the database was last copied, and how many copies are kept. */
function BackupStatus({ backup }: { readonly backup: ServerData["backup"] }) {
  const now = useNow();
  if (backup.newestAt == null) {
    return <StatusPill tone="warning" label="Ainda não feito" />;
  }
  return (
    <>
      {formatTimeAgo(backup.newestAt, now)} · {backup.count} de {backup.kept} guardados
    </>
  );
}

/** Worker connection, Docker and the settings the worker runs with. */
export function WorkerSection({ server }: { readonly server: ServerData }) {
  return (
    <Section icon={ContainerIcon} title="Worker e Docker">
      <dl className="divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border/70">
        <WorkerRows worker={server.worker} />
        <ConfigurationRows server={server} />
      </dl>
    </Section>
  );
}
