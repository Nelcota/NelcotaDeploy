import { CopyButton } from "@/web/components/layout/copy-button";

import { dnsRecordType } from "./domains";

/** Chooses the manual DNS instructions from the addresses available to the panel. */
export function ManualDnsRecord({
  hostname,
  alias,
  serverAddress,
  loading,
}: {
  readonly hostname: string;
  readonly alias: string | null;
  readonly serverAddress: { readonly address: string; readonly type: "A" | "AAAA" } | null;
  readonly loading: boolean;
}) {
  const type = dnsRecordType(alias, serverAddress?.type ?? null);
  const value = type === "CNAME" ? alias : (serverAddress?.address ?? null);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Consultando o destino do registro…</p>;
  }

  if (value == null) {
    return (
      <p className="text-sm text-muted-foreground">
        Peça ao administrador o IP público do servidor para configurar este registro.
      </p>
    );
  }

  return <DnsRecordFields hostname={hostname} type={type} value={value} />;
}

/** The fields users enter when configuring this exact hostname in their DNS provider. */
export function DnsRecordFields({
  hostname,
  type,
  value,
}: {
  readonly hostname: string;
  readonly type: "A" | "AAAA" | "CNAME";
  readonly value: string;
}) {
  return (
    <div className="space-y-3 rounded-lg bg-well/60 p-3">
      <dl className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <dt className="text-xs text-muted-foreground">Tipo</dt>
          <dd className="font-mono text-sm font-medium">{type}</dd>
        </div>
        <DnsCopyField label="Nome" value={hostname} hostname={hostname} />
        <DnsCopyField label="Valor" value={value} hostname={hostname} />
      </dl>
      <p className="text-xs text-muted-foreground">
        Se o provedor completar o domínio, cole só a parte que falta.{" "}
        {type === "CNAME"
          ? "Para a raiz, peça o IP público do servidor e use um registro A ou AAAA."
          : "Para a raiz, use @."}
      </p>
    </div>
  );
}

function DnsCopyField({
  label,
  value,
  hostname,
}: {
  readonly label: string;
  readonly value: string;
  readonly hostname: string;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="space-y-2">
        <p className="font-mono text-sm wrap-anywhere select-text">{value}</p>
        <CopyButton
          text={value}
          label={`Copiar ${label.toLowerCase()}`}
          context={hostname}
          className="min-h-11 w-full sm:w-auto"
        />
      </dd>
    </div>
  );
}
