import { BanIcon, CalendarClockIcon, ClockIcon } from "lucide-react";

import { formatDate, formatRelativeTime } from "@/shared/format";
import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { ListRow, Tag } from "@/web/components/layout/layout";
import { StatusPill } from "@/web/components/layout/status-badge";
import { Button } from "@/web/components/ui/button";
import type { listApiTokensFn } from "@/web/functions/settings.functions";

import { SCOPES } from "./token-scopes";
import { tokenState } from "./token-state";

export type TokenView = Awaited<ReturnType<typeof listApiTokensFn>>[number];

function TokenDates({ token, now }: { readonly token: TokenView; readonly now: Date }) {
  return (
    <dl className="flex gap-6 text-xs md:shrink-0">
      <div className="space-y-0.5">
        <dt className="flex items-center gap-1.5 text-muted-foreground">
          <ClockIcon aria-hidden className="size-3.5" />
          Último uso
        </dt>
        <dd>
          {token.lastUsedAt == null ? "Nunca usado" : formatRelativeTime(token.lastUsedAt, now)}
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
  );
}

function RevokeTokenButton({
  name,
  onConfirm,
}: {
  readonly name: string;
  readonly onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm">
          <BanIcon aria-hidden />
          Revogar
        </Button>
      }
      title={`Revogar o token ${name}?`}
      description="Clientes MCP que usam este token perdem o acesso imediatamente."
      confirmLabel="Revogar"
      destructive
      onConfirm={onConfirm}
    />
  );
}

/** One API token with its scopes, dates, state and the revoke action. */
export function TokenRow({
  token,
  now,
  onRevoke,
}: {
  readonly token: TokenView;
  readonly now: Date;
  readonly onRevoke: () => void;
}) {
  const state = tokenState(token, now);
  return (
    <ListRow className="flex-wrap md:flex-nowrap">
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
      <TokenDates token={token} now={now} />
      <StatusPill tone={state.tone} label={state.label} />
      {token.revokedAt == null ? (
        <RevokeTokenButton name={token.name} onConfirm={onRevoke} />
      ) : null}
    </ListRow>
  );
}
