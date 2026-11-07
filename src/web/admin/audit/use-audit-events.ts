import { useInfiniteQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PageCursor } from "@/shared/pagination";
import { toUserMessage } from "@/web/components/layout/error-message";
import { listAuditEventsFn } from "@/web/functions/admin/audit.functions";

/** Audit events, newest first, with on-demand loading of older pages. */
export function useAuditEvents() {
  const query = useInfiniteQuery({
    queryKey: ["audit"],
    initialPageParam: undefined,
    queryFn: ({ pageParam }: { readonly pageParam: PageCursor | undefined }) =>
      listAuditEventsFn({ data: { before: pageParam } }),
    getNextPageParam: (lastPage) => {
      const last = lastPage.at(-1);
      return last == null ? undefined : { createdAt: last.createdAt, id: last.id };
    },
  });
  const events = query.data?.pages.flat() ?? [];

  const loadMore = async () => {
    if (query.hasNextPage === false || query.isFetching) {
      return;
    }
    try {
      await query.fetchNextPage({ cancelRefetch: false, throwOnError: true });
    } catch (error) {
      toast.error(toUserMessage(error, "Não foi possível carregar mais eventos."));
    }
  };

  return { query, events, loadMore };
}
