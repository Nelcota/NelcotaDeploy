import { Link } from "@tanstack/react-router";

import { formatDateTime } from "@/shared/format";
import { useCan } from "@/web/components/shell/use-permissions";
import { Button } from "@/web/components/ui/button";
import type { readProxyLogsFn } from "@/web/functions/domains/proxy-logs.functions";

import { dnsConfigurationId } from "../domains";

type Snapshot = Extract<Awaited<ReturnType<typeof readProxyLogsFn>>, { status: "ready" }>;
type Entry = Snapshot["entries"][number];

const ADVICE = {
  dns: {
    title: "Falha no DNS",
    action:
      "Compare os registros A, AAAA ou CNAME do provedor com o destino indicado no painel. Corrija os que apontam para outro endereço e aguarde a propagação.",
    destination: "dns",
  },
  timeout: {
    title: "A validação demorou demais",
    action:
      "Peça ao administrador para confirmar se a porta 80 do servidor está acessível pela internet e se o firewall permite a validação do domínio.",
    destination: "server",
  },
  connection: {
    title: "Falha de conexão na validação",
    action:
      "Peça ao administrador para conferir se o proxy está rodando no servidor do projeto e se aceita conexões na porta 80.",
    destination: "server",
  },
  challenge: {
    title: "Resposta de validação rejeitada",
    action:
      "Confira o destino do DNS. Se houver CDN ou redirecionamento, peça ao administrador para verificar se ele deixa a solicitação de validação chegar ao proxy.",
    destination: "dns",
  },
  "rate-limit": {
    title: "Limite de emissão atingido",
    action:
      "Aguarde o prazo informado pela autoridade certificadora antes de tentar emitir outro certificado. Evite novos deploys só para tentar emitir novamente.",
    destination: "limits",
  },
  other: {
    title: "Falha de certificado registrada pelo proxy",
    action:
      "Envie o domínio e o horário abaixo ao administrador para que ele possa localizar o erro e revisar a configuração do proxy no servidor.",
    destination: "server",
  },
} as const satisfies Record<
  Entry["reason"],
  { title: string; action: string; destination: string }
>;

/** A certificate log with an action and a shortcut to the relevant settings. */
export function CertificateLogEntry({
  entry,
  projectId,
  hostname,
}: {
  readonly entry: Entry;
  readonly projectId: string;
  readonly hostname: string;
}) {
  const advice = ADVICE[entry.reason];
  const can = useCan();
  const params = { projectId };
  const links = {
    dns: (
      <Link to="/projects/$projectId/dns" params={params} hash={dnsConfigurationId(hostname)}>
        Ver configuração DNS
      </Link>
    ),
    server: (
      <Link to="/projects/$projectId/settings/server" params={params}>
        Ver servidor do projeto
      </Link>
    ),
    limits: (
      <a
        href="https://letsencrypt.org/docs/rate-limits/#retrying-after-hitting-rate-limits"
        target="_blank"
        rel="noopener noreferrer"
      >
        Consultar limites do Let’s Encrypt<span className="sr-only"> em nova aba</span>
      </a>
    ),
  };
  return (
    <li className="space-y-2 rounded-lg border border-border bg-card p-3">
      <p className="font-semibold">{advice.title}</p>
      <time dateTime={entry.time} className="block text-xs text-muted-foreground tabular-nums">
        {formatDateTime(entry.time)}
      </time>
      <p className="text-muted-foreground">{advice.action}</p>
      {entry.retryAt == null ? null : (
        <p className="text-muted-foreground">
          Prazo informado para nova tentativa{" "}
          <time dateTime={entry.retryAt} className="font-medium text-foreground">
            {formatDateTime(entry.retryAt)}
          </time>
          .
        </p>
      )}
      {advice.destination === "server" && can("settings:write") === false ? null : (
        <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
          {links[advice.destination]}
        </Button>
      )}
    </li>
  );
}
