import { useQuery } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";

import { useNow } from "@/web/components/clock/use-now";
import { List } from "@/web/components/layout/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { useAction } from "@/web/components/layout/use-action";
import { listApiTokensFn, revokeApiTokenFn } from "@/web/functions/admin/api-tokens.functions";

import { TokenRow, type TokenView } from "./token-row";

const SKELETON_ROWS = 2;

/** Every API token, with the loading, error and empty states of the list. */
export function TokenList() {
  const tokens = useQuery({ queryKey: ["api-tokens"], queryFn: () => listApiTokensFn() });
  return (
    <>
      {tokens.isError ? (
        <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
      ) : null}
      <TokenListBody tokens={tokens.data} isError={tokens.isError} />
    </>
  );
}

function TokenListBody({
  tokens,
  isError,
}: {
  readonly tokens: readonly TokenView[] | undefined;
  readonly isError: boolean;
}) {
  if (tokens == null) {
    return isError ? null : <ListSkeleton rows={SKELETON_ROWS} />;
  }
  if (tokens.length === 0) {
    return (
      <EmptyState
        icon={KeyRoundIcon}
        title="Nenhum token criado"
        description="Crie um token para conectar o Claude Code ou outro cliente MCP."
      />
    );
  }
  return <TokenRows tokens={tokens} />;
}

function TokenRows({ tokens }: { readonly tokens: readonly TokenView[] }) {
  const now = useNow();
  const revoke = useAction({
    action: (tokenId: string) => revokeApiTokenFn({ data: { tokenId } }),
    successMessage: "Token revogado",
    invalidate: [["api-tokens"]],
  });
  return (
    <List>
      {tokens.map((token) => (
        <TokenRow key={token.id} token={token} now={now} onRevoke={() => revoke.mutate(token.id)} />
      ))}
    </List>
  );
}
