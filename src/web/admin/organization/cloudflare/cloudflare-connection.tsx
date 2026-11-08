import { useQuery } from "@tanstack/react-query";
import { CloudIcon } from "lucide-react";
import { useState } from "react";

import { cloudflareTokenSchema } from "@/shared/schemas/dns/cloudflare.schema";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { toUserMessage } from "@/web/components/layout/error-message";
import { Section } from "@/web/components/layout/layout";
import { useAction } from "@/web/components/layout/use-action";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import {
  connectCloudflareFn,
  disconnectCloudflareFn,
  getCloudflareConnectionFn,
} from "@/web/functions/domains/cloudflare.functions";

/** One-time encrypted provider connection; DNS changes require their own explicit review. */
export function CloudflareConnection({ canEdit }: { readonly canEdit: boolean }) {
  const connection = useQuery({
    queryKey: ["cloudflare-connection"],
    queryFn: () => getCloudflareConnectionFn(),
  });
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const invalidate = [["cloudflare-connection"], ["cloudflare-dns"]];
  const connect = useAction({
    action: (value: string) => connectCloudflareFn({ data: { token: value } }),
    successMessage:
      "Cloudflare conectada. Os registros serão alterados somente após sua confirmação.",
    invalidate,
    onSuccess: () => setToken(""),
  });
  const disconnect = useAction({
    action: () => disconnectCloudflareFn(),
    successMessage: "Integração com a Cloudflare desconectada",
    invalidate,
  });
  const busy = connect.isPending || disconnect.isPending;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const parsed = cloudflareTokenSchema.safeParse(token);
    if (parsed.success === false) {
      setError(parsed.error.issues.at(0)?.message ?? "Token inválido");
      return;
    }
    setError(null);
    connect.mutate(parsed.data);
  };
  return (
    <Section icon={CloudIcon} title="DNS automático com Cloudflare">
      <Card className="gap-4 p-5">
        {connection.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Consultando integração…
          </p>
        ) : null}
        {connection.isError ? (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-warning">
              {toUserMessage(connection.error, "Não foi possível consultar a integração.")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={connection.isFetching}
              onClick={() => void connection.refetch()}
            >
              Consultar conexão com a Cloudflare
            </Button>
          </div>
        ) : null}
        {connection.data?.configured === true ? (
          <p className="text-sm text-success">
            Conectada · {connection.data.zoneCount} zona(s) acessível(is)
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Conecte uma vez para o painel detectar a zona e preparar os registros de cada projeto.
          </p>
        )}
        {canEdit ? (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="cloudflare-api-token">API Token da Cloudflare</Label>
              <Input
                id="cloudflare-api-token"
                type="password"
                autoComplete="off"
                disabled={busy}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={
                  connection.data?.configured === true
                    ? "Novo token para substituir a conexão"
                    : "Cole seu API Token"
                }
                aria-describedby="cloudflare-token-hint cloudflare-token-error"
                aria-invalid={error != null}
              />
            </div>
            <p id="cloudflare-token-hint" className="text-xs text-muted-foreground">
              Use um token com leitura de zonas e edição de DNS, limitado aos domínios que deseja
              gerenciar. O token será armazenado criptografado.{" "}
              <a
                href="https://dash.cloudflare.com/profile/api-tokens"
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                Criar API Token
              </a>
            </p>
            <p
              id="cloudflare-token-error"
              role="alert"
              className="text-sm text-destructive empty:hidden"
            >
              {error}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || token.trim() === ""}>
                {connect.isPending ? "Conectando…" : "Conectar Cloudflare"}
              </Button>
              {connection.data?.configured === true ? (
                <ConfirmDialog
                  trigger={
                    <Button type="button" variant="outline" disabled={busy}>
                      Desconectar Cloudflare
                    </Button>
                  }
                  title="Desconectar a Cloudflare?"
                  description="O painel deixará de configurar DNS. Os registros existentes continuarão ativos na Cloudflare."
                  confirmLabel="Desconectar Cloudflare"
                  onConfirm={() => disconnect.mutate()}
                />
              ) : null}
            </div>
          </form>
        ) : null}
      </Card>
    </Section>
  );
}
