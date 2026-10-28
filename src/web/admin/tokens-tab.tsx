import { useQuery } from "@tanstack/react-query";
import {
  BanIcon,
  CalendarClockIcon,
  ClockIcon,
  EyeIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  type LucideIcon,
  PlusIcon,
  RocketIcon,
  ShieldPlusIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";

import { formatDate, formatRelativeTime } from "@/shared/format";
import { ConfirmDialog } from "@/web/components/confirm-dialog";
import { CopyButton } from "@/web/components/copy-button";
import { FormField } from "@/web/components/form-field";
import { List, ListRow, Section, Tag } from "@/web/components/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/states";
import { StatusPill } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
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

import { expiryFor, tokenState } from "./token-state";

// Same limit the server applies to token validity.
const MAX_TOKEN_DAYS = 365;

type TokenScope = "read" | "deploy";

const DEFAULT_TOKEN_DAYS = "90";

const SCOPES: readonly {
  readonly value: TokenScope;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}[] = [
  {
    value: "read",
    label: "Leitura",
    description: "Consultar projetos, deploys, logs e métricas.",
    icon: EyeIcon,
  },
  {
    value: "deploy",
    label: "Deploy",
    description: "Disparar deploys e reiniciar contêineres.",
    icon: RocketIcon,
  },
];

/** API tokens for the MCP server: create, list and revoke. */
export function TokensTab() {
  const tokens = useQuery({ queryKey: ["api-tokens"], queryFn: () => listApiTokensFn() });
  const [createOpen, setCreateOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const revoke = useAction({
    action: (tokenId: string) => revokeApiTokenFn({ data: { tokenId } }),
    successMessage: "Token revogado",
    invalidate: [["api-tokens"]],
  });
  const now = new Date();
  return (
    <Section
      icon={KeyRoundIcon}
      title="Tokens de API"
      description="Usados pelo servidor MCP. Dê a cada cliente o menor escopo possível; só o hash do token é guardado."
      action={
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon aria-hidden />
          Novo token
        </Button>
      }
    >
      {tokens.isError ? (
        <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
      ) : null}
      {tokens.data == null && tokens.isError === false ? <ListSkeleton rows={2} /> : null}
      {tokens.data?.length === 0 ? (
        <EmptyState
          icon={KeyRoundIcon}
          title="Nenhum token criado"
          description="Crie um token para conectar o Claude Code ou outro cliente MCP."
        />
      ) : null}
      {tokens.data != null && tokens.data.length > 0 ? (
        <List>
          {tokens.data.map((token) => {
            const state = tokenState(token, now);
            return (
              <ListRow key={token.id} className="flex-wrap md:flex-nowrap">
                <div className="min-w-0 flex-1 basis-full space-y-1.5 md:basis-auto">
                  <p className="truncate text-sm font-medium">{token.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SCOPES.filter((scope) => token.scopes.includes(scope.value)).map((scope) => (
                      <Tag key={scope.value} icon={scope.icon}>
                        {scope.label}
                      </Tag>
                    ))}
                  </div>
                </div>
                <dl className="flex gap-6 text-xs md:shrink-0">
                  <div className="space-y-0.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <ClockIcon aria-hidden className="size-3.5" />
                      Último uso
                    </dt>
                    <dd>
                      {token.lastUsedAt == null
                        ? "Nunca usado"
                        : formatRelativeTime(token.lastUsedAt, now)}
                    </dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <CalendarClockIcon aria-hidden className="size-3.5" />
                      Expira em
                    </dt>
                    <dd>{token.expiresAt == null ? "Não expira" : formatDate(token.expiresAt)}</dd>
                  </div>
                </dl>
                <StatusPill tone={state.tone} label={state.label} />
                {token.revokedAt == null ? (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm">
                        <BanIcon aria-hidden />
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
            );
          })}
        </List>
      ) : null}
      {/* Mounted only while open, so a cancelled draft starts clean next time. */}
      {createOpen ? (
        <CreateTokenDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(token) => {
            setCreateOpen(false);
            setCreatedToken(token);
          }}
        />
      ) : null}
      <CreatedTokenDialog token={createdToken} onClose={() => setCreatedToken(null)} />
    </Section>
  );
}

function CreateTokenDialog({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (token: string) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ReadonlySet<TokenScope>>(new Set<TokenScope>(["read"]));
  const [expiresInDays, setExpiresInDays] = useState(DEFAULT_TOKEN_DAYS);
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
    onSuccess: (result) => onCreated(result.token),
  });
  const now = new Date();
  const expiry = expiryFor(expiresInDays, now, MAX_TOKEN_DAYS);
  const toggleScope = (scope: TokenScope, checked: boolean) => {
    setScopes((current) =>
      checked ? current.union(new Set([scope])) : current.difference(new Set([scope])),
    );
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = {
      ...(name.trim() === "" ? { name: "Informe um nome" } : {}),
      ...(scopes.size === 0 ? { scopes: "Escolha pelo menos um escopo" } : {}),
      ...(expiry === undefined
        ? { expiresInDays: `Informe de 1 a ${MAX_TOKEN_DAYS} dias inteiros, ou deixe em branco` }
        : {}),
    };
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    const days = expiresInDays.trim() === "" ? null : Number(expiresInDays.trim());
    create.mutate({ name: name.trim(), scopes: [...scopes], expiresInDays: days });
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo token de API</DialogTitle>
          <DialogDescription>
            O token é exibido uma única vez, logo após a criação.
          </DialogDescription>
        </DialogHeader>
        <form noValidate className="space-y-4" onSubmit={submit}>
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
          <fieldset className="space-y-3" aria-describedby="token-scopes-error">
            <legend className="mb-2 text-sm font-medium">Escopos</legend>
            {SCOPES.map((scope) => (
              <div key={scope.value} className="flex items-start gap-2.5">
                <Checkbox
                  id={`token-scope-${scope.value}`}
                  className="mt-0.5"
                  checked={scopes.has(scope.value)}
                  onCheckedChange={(checked) => toggleScope(scope.value, checked === true)}
                  aria-describedby={`token-scope-${scope.value}-hint`}
                />
                <div className="space-y-0.5">
                  <Label htmlFor={`token-scope-${scope.value}`}>{scope.label}</Label>
                  <p
                    id={`token-scope-${scope.value}-hint`}
                    className="text-xs text-muted-foreground"
                  >
                    {scope.description}
                  </p>
                </div>
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
            hint={
              typeof expiry === "string"
                ? `Expira em ${formatDate(expiry)}.`
                : "Deixe em branco para não expirar (não recomendado)."
            }
            errors={errors.expiresInDays == null ? [] : [errors.expiresInDays]}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_TOKEN_DAYS}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? (
                <LoaderCircleIcon aria-hidden className="animate-spin" />
              ) : (
                <ShieldPlusIcon aria-hidden />
              )}
              Criar token
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
