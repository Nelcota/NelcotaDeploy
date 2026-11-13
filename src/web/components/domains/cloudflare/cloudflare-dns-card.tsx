import { useQuery } from "@tanstack/react-query";
import { CloudIcon } from "lucide-react";
import { useState } from "react";

import { toUserMessage } from "@/web/components/layout/error-message";
import { CardTitleRow } from "@/web/components/layout/layout";
import { useAction } from "@/web/components/layout/use-action";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import {
  applyCloudflareDnsFn,
  previewCloudflareDnsFn,
} from "@/web/functions/domains/cloudflare.functions";

import { DnsRecordFields } from "../dns-record-fields";
import type { DomainItem } from "../domains";
import { DnsReviewDialog, type DnsReview } from "./dns-review-dialog";

const PLAN_STALE_TIME_IN_MS = 15_000;

/** Detects the zone and target records on its own, then waits for a reviewed confirmation. */
export function CloudflareDnsCard({
  projectId,
  domains,
  revision,
}: {
  readonly projectId: string;
  readonly domains: readonly DomainItem[];
  readonly revision: string | null;
}) {
  const [selected, setSelected] = useState("");
  const [reviewed, setReviewed] = useState<DnsReview | null>(null);
  const hostname = domains.some((domain) => domain.hostname === selected)
    ? selected
    : (domains.at(0)?.hostname ?? "");
  const plan = useQuery({
    queryKey: ["cloudflare-dns", projectId, hostname, revision],
    queryFn: () => previewCloudflareDnsFn({ data: { projectId, hostname } }),
    enabled: hostname !== "",
    staleTime: PLAN_STALE_TIME_IN_MS,
    retry: false,
  });
  const apply = useAction({
    action: (review: DnsReview) =>
      applyCloudflareDnsFn({
        data: { projectId, hostname: review.hostname, confirmation: review.confirmation },
      }),
    successMessage: (result) =>
      result.changed === 0
        ? "O DNS já está configurado"
        : "Registros atualizados na Cloudflare. Aguardando propagação.",
    invalidate: [
      ["cloudflare-dns", projectId],
      ["domains-dns", projectId],
    ],
    onSuccess: () => setReviewed(null),
  });
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={CloudIcon} title="DNS automático com Cloudflare" />
      {domains.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Adicione um domínio para o painel detectar os registros.
        </p>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="cloudflare-dns-hostname">Domínio</Label>
          <Select value={hostname} onValueChange={setSelected}>
            <SelectTrigger id="cloudflare-dns-hostname" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {domains.map((domain) => (
                <SelectItem key={domain.hostname} value={domain.hostname}>
                  {domain.hostname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {plan.isFetching ? (
        <p role="status" className="text-sm text-muted-foreground">
          Detectando zona e registros existentes…
        </p>
      ) : null}
      {plan.isError ? (
        <p role="alert" className="text-sm text-warning">
          {toUserMessage(plan.error, "Não foi possível preparar a configuração de DNS.")}
        </p>
      ) : null}
      {plan.data == null ? null : (
        <div className="space-y-2 text-sm">
          <p>
            Zona detectada: <span className="font-mono">{plan.data.zone}</span>
          </p>
          <DnsRecordFields
            hostname={plan.data.desired.name}
            type={plan.data.desired.type}
            value={plan.data.desired.content}
          />
          {plan.data.changes.length === 0 ? (
            <p className="text-success">
              Os registros já apontam para o servidor do projeto.
              {plan.data.desired.proxied
                ? " O DNS público exibirá os IPs do proxy Cloudflare."
                : ""}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {plan.data.changes.length} alteração(ões) preparada(s). Confira antes de aplicar.
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={plan.isFetching || hostname === ""}
          onClick={() => void plan.refetch()}
        >
          Consultar registros DNS novamente
        </Button>
        {plan.data == null || plan.data.changes.length === 0 ? null : (
          <Button
            type="button"
            disabled={plan.isFetching || plan.isError}
            onClick={() => setReviewed(plan.data)}
          >
            Revisar configuração de DNS
          </Button>
        )}
      </div>
      {reviewed == null ? null : (
        <DnsReviewDialog
          review={reviewed}
          pending={apply.isPending}
          onClose={() => setReviewed(null)}
          onConfirm={() => apply.mutate(reviewed)}
        />
      )}
    </Card>
  );
}
