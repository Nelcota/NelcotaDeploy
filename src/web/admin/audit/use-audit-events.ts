import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { toUserMessage } from "@/web/components/layout/error-message";
import { listAuditEventsFn } from "@/web/functions/admin/audit.functions";

import type { AuditEvent } from "./audit-row";

/** Audit events, newest first, with on-demand loading of older pages. */
export function useAuditEvents() {
  const firstPage = useQuery({
    queryKey: ["audit"],
    queryFn: () => listAuditEventsFn({ data: {} }),
  });
  const [olderPages, setOlderPages] = useState<AuditEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const events = [...(firstPage.data ?? []), ...olderPages];

  const loadMore = async () => {
    const last = events.at(-1);
    if (last == null) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await listAuditEventsFn({ data: { before: last.createdAt } });
      setOlderPages((current) => [...current, ...page]);
      setExhausted(page.length === 0);
    } catch (error) {
      toast.error(toUserMessage(error, "Não foi possível carregar mais eventos."));
    } finally {
      setLoadingMore(false);
    }
  };

  return { firstPage, events, loadingMore, exhausted, loadMore };
}
