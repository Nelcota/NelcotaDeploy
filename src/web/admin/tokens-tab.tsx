import { useQuery } from "@tanstack/react-query";
import { KeyRoundIcon, LoaderCircleIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { formatDateTime, formatRelativeTime } from "@/shared/format";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { CopyButton } from "@/web/components/copy-button";
import { FormField } from "@/web/components/form-field";
import { List, ListRow, Section } from "@/web/components/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { StatusPill } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { Checkbox } from "@/web/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { useAction } from "@/web/components/use-action";
import {
  createApiTokenFn,
  listApiTokensFn,
  revokeApiTokenFn,
} from "@/web/functions/settings.functions";

// Same limit the server applies to token validity.
const MAX_TOKEN_DAYS = 365;

type TokenScope = "read" | "deploy";

const SCOPE_LABELS: Record<TokenScope, string> = {
  read: "Leitura (consultar projetos, deploys, logs e métricas)",
  deploy: "Deploy (disparar deploys e reiniciar contêineres)",
};

/** API tokens for the MCP server: create, list and revoke. */
export function TokensTab() {
  const tokens = useQuery({ queryKey: ["api-tokens"], queryFn: () => listApiTokensFn() });
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const revoke = useAction({
    action: (tokenId: string) => revokeApiTokenFn({ data: { tokenId } }),
    successMessage: "Token revogado",
    invalidate: [["api-tokens"]],
  });
  const now = new Date();
  return (
    <div className="space-y-10">
      <CreateTokenCard onCreated={setCreatedToken} />
      <Section
        title="Tokens existentes"
        description="Usados pelo servidor MCP. Apenas o hash do token é armazenado."
      >
        {tokens.isError ? (
          <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
        ) : null}
        {tokens.data == null && tokens.isError === false ? <ListSkeleton rows={2} /> : null}
        {tokens.data?.length === 0 ? (
          <EmptyState icon={KeyRoundIcon} title="Nenhum token criado" />
        ) : null}
        {tokens.data != null && tokens.data.length > 0 ? (
          <List>
            {tokens.data.map((token) => (
              <ListRow
                key={token.id}
                accent={token.revokedAt == null ? "success" : "neutral"}
                className="flex-wrap md:flex-nowrap"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium">{token.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {token.scopes
                      .map((scope) => (scope === "deploy" ? "Deploy" : "Leitura"))
                      .join(" · ")}
                  </p>
                </div>
                <dl className="flex w-full gap-6 text-xs md:w-auto md:shrink-0">
                  <div>
                    <dt className="text-muted-foreground">Último uso</dt>
                    <dd>
                      {token.lastUsedAt == null
                        ? "Nunca usado"
                        : formatRelativeTime(token.lastUsedAt, now)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Expira em</dt>
                    <dd>
                      {token.expiresAt == null ? "Não expira" : formatDateTime(token.expiresAt)}
                    </dd>
                  </div>
                </dl>
                <StatusPill
                  tone={token.revokedAt == null ? "success" : "neutral"}
                  label={token.revokedAt == null ? "Ativo" : "Revogado"}
                />
                {token.revokedAt == null ? (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm">
                        Revogar
                      </Button>
                    }
                    title={`Revogar o token ${token.name}?`}
                    description="Clientes MCP que usam este token perdem o acesso imediatamente."
                    confirmLabel="Revogar"
                    destructive
                    onConfirm={() => revoke.mutate(token.id)}
                  />
                ) : null}
              </ListRow>
            ))}
          </List>
        ) : null}
      </Section>
      <CreatedTokenDialog token={createdToken} onClose={() => setCreatedToken(null)} />
    </div>
  );
}

function CreateTokenCard({ onCreated }: { readonly onCreated: (token: string) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ReadonlySet<TokenScope>>(new Set<TokenScope>(["read"]));
  const [expiresInDays, setExpiresInDays] = useState("");
  const [errors, setErrors] = useState<{
    readonly name?: string;
    readonly scopes?: string;
    readonly expiresInDays?: string;
  }>({});
  const create = useAction({
    action: (data: { name: string; scopes: TokenScope[]; expiresInDays: number | null }) =>
      createApiTokenFn({ data }),
    successMessage: "Token criado",
    invalidate: [["api-tokens"]],
    onSuccess: (result) => {
      setName("");
      setScopes(new Set<TokenScope>(["read"]));
      setExpiresInDays("");
      onCreated(result.token);
    },
  });
  const toggleScope = (scope: TokenScope, checked: boolean) => {
    setScopes((current) =>
      checked ? current.union(new Set([scope])) : current.difference(new Set([scope])),
    );
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedDays = expiresInDays.trim();
    const days = trimmedDays === "" ? null : Number(trimmedDays);
    const nextErrors = {
      ...(name.trim() === "" ? { name: "Informe um nome" } : {}),
      ...(scopes.size === 0 ? { scopes: "Escolha pelo menos um escopo" } : {}),
      ...(days != null && (Number.isInteger(days) === false || days < 1 || days > MAX_TOKEN_DAYS)
        ? { expiresInDays: `Informe de 1 a ${MAX_TOKEN_DAYS} dias inteiros, ou deixe em branco` }
        : {}),
    };
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    create.mutate({ name: name.trim(), scopes: [...scopes], expiresInDays: days });
  };
  return (
    <Section
      title="Novo token de API"
      description="Dê a cada cliente o menor escopo possível. O token é exibido uma única vez."
    >
      <Card className="p-5">
        <form className="max-w-lg space-y-4" onSubmit={submit}>
          <FormField id="token-name" label="Nome" errors={errors.name == null ? [] : [errors.name]}>
            {(props) => (
              <Input
                {...props}
                placeholder="claude-code-notebook"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </FormField>
          <fieldset className="space-y-2" aria-describedby="token-scopes-error">
            <legend className="text-sm font-medium">Escopos</legend>
            {(["read", "deploy"] as const).map((scope) => (
              <div key={scope} className="flex items-center gap-2">
                <Checkbox
                  id={`token-scope-${scope}`}
                  checked={scopes.has(scope)}
                  onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                />
                <Label htmlFor={`token-scope-${scope}`} className="font-normal">
                  {SCOPE_LABELS[scope]}
                </Label>
              </div>
            ))}
            <p
              id="token-scopes-error"
              aria-live="polite"
              className="text-xs font-medium text-destructive empty:hidden"
            >
              {errors.scopes ?? ""}
            </p>
          </fieldset>
          <FormField
            id="token-expiry"
            label="Validade em dias"
            hint="Deixe em branco para não expirar."
            errors={errors.expiresInDays == null ? [] : [errors.expiresInDays]}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={1}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
              />
            )}
          </FormField>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            Criar token
          </Button>
        </form>
      </Card>
    </Section>
  );
}

function CreatedTokenDialog({
  token,
  onClose,
}: {
  readonly token: string | null;
  readonly onClose: () => void;
}) {
  const command =
    token == null
      ? ""
      : `claude mcp add nelcota --env NELCOTA_MCP_TOKEN=${token} --env DATABASE_PATH=/caminho/para/data/nelcota.db -- bun run /caminho/para/o/repositorio/src/mcp/main.ts`;
  return (
    <Dialog open={token != null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {/* Shown only once: a stray click or Esc must not throw the token away. */}
      <DialogContent
        className="sm:max-w-2xl"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Copie o token agora</DialogTitle>
          <DialogDescription>
            Ele não será exibido novamente. Guarde-o em um gerenciador de senhas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="created-token">Token</Label>
            <div className="flex gap-2">
              <Input id="created-token" readOnly className="font-mono" value={token ?? ""} />
              <CopyButton text={token ?? ""} label="Copiar" />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Exemplo para o Claude Code</p>
            <pre className="overflow-x-auto rounded-lg bg-console p-3 font-mono text-xs break-all whitespace-pre-wrap text-console-foreground">
              {command}
            </pre>
            <div className="flex justify-end">
              <CopyButton text={command} label="Copiar comando" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Já copiei o token</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
