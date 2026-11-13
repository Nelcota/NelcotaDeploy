import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, ScrollTextIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { toUserMessage } from "@/web/components/layout/error-message";
import { Button } from "@/web/components/ui/button";
import { readProxyLogsFn, requestProxyLogsFn } from "@/web/functions/domains/proxy-logs.functions";

import { certificateHistoryId } from "../domains";
import { CertificateLogEntry } from "./certificate-log-entry";
import { type HttpsCheck, VerifyDomainHttps } from "./verify-domain-https";

const RESULT_REFRESH_IN_MS = 1500;

/** Loads a domain's certificate errors on demand, within the current page. */
export function ProxyCertificateLogs({
  projectId,
  hostname,
  visible,
  initiallyOpen,
  healthy,
  onChecked,
  activeCheckAt,
}: {
  readonly projectId: string;
  readonly hostname: string;
  readonly visible: boolean;
  readonly initiallyOpen: boolean;
  readonly healthy: boolean;
  readonly onChecked: (result: HttpsCheck) => void;
  readonly activeCheckAt: string | undefined;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const request = useMutation({
    mutationFn: () => requestProxyLogsFn({ data: { projectId, hostname } }),
  });
  const { isIdle, mutate } = request;
  useEffect(() => {
    if (open && isIdle) {
      mutate();
    }
  }, [open, isIdle, mutate]);

  const requestId = request.data ?? null;
  const result = useQuery({
    queryKey: ["proxy-certificate-logs", projectId, hostname, requestId],
    queryFn: () => readProxyLogsFn({ data: { projectId, hostname, requestId: requestId ?? "" } }),
    enabled: open && requestId != null,
    refetchInterval: (query) =>
      query.state.data?.status === "queued" || query.state.data?.status === "running"
        ? RESULT_REFRESH_IN_MS
        : false,
  });

  if (visible === false && open === false) {
    return null;
  }

  return (
    <details
      className="group rounded-lg border border-border open:bg-well/40"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        id={certificateHistoryId(hostname)}
        className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
      >
        <ScrollTextIcon aria-hidden className="size-4 shrink-0" />
        {healthy || initiallyOpen ? "Histórico de erros do certificado" : "Ver logs do proxy"}
        <ChevronDownIcon aria-hidden className="ml-auto size-4 shrink-0 group-open:rotate-180" />
      </summary>
      {open ? (
        <div className="space-y-3 px-3 pb-3 text-sm">
          <p className="text-muted-foreground">
            Erros de certificado de{" "}
            <span className="font-medium text-foreground wrap-anywhere">{hostname}</span> desde o
            início do deploy atual, nas últimas 24 horas.
          </p>
          {healthy ? (
            <p className="text-muted-foreground">
              Os registros abaixo mostram ocorrências anteriores.
            </p>
          ) : null}
          <VerifyDomainHttps
            projectId={projectId}
            hostname={hostname}
            onChecked={onChecked}
            activeCheckAt={activeCheckAt}
          />
          <ProxyLogResult request={request} result={result} target={{ projectId, hostname }} />
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            aria-disabled={request.isPending || result.isFetching}
            onClick={() => {
              if (request.isPending === false && result.isFetching === false) {
                request.mutate(undefined, {
                  onSuccess: (id) => {
                    if (id === requestId) {
                      void result.refetch();
                    }
                  },
                });
              }
            }}
          >
            Atualizar histórico do proxy
          </Button>
        </div>
      ) : null}
    </details>
  );
}

function ProxyLogResult({
  request,
  result,
  target,
}: {
  readonly target: { readonly projectId: string; readonly hostname: string };
  readonly request: {
    readonly isError: boolean;
    readonly error: unknown;
    readonly isPending: boolean;
  };
  readonly result: {
    readonly isError: boolean;
    readonly error: unknown;
    readonly data: Awaited<ReturnType<typeof readProxyLogsFn>> | undefined;
  };
}) {
  if (request.isError || result.isError) {
    return (
      <p role="status" className="text-muted-foreground">
        {toUserMessage(
          request.error ?? result.error,
          "Não foi possível consultar os logs do proxy.",
        )}
      </p>
    );
  }

  if (
    request.isPending ||
    result.data == null ||
    result.data.status === "queued" ||
    result.data.status === "running"
  ) {
    return (
      <p role="status" className="text-muted-foreground">
        {result.data?.status === "queued"
          ? "Consulta na fila do servidor…"
          : "Consultando o proxy…"}
      </p>
    );
  }

  if (result.data.status !== "ready") {
    return (
      <p role="status" className="text-muted-foreground">
        Não foi possível carregar os logs deste proxy. Tente consultar novamente.
      </p>
    );
  }

  if (result.data.entries.length === 0) {
    return (
      <p role="status" className="text-muted-foreground">
        Nenhum erro de certificado encontrado nos logs recentes deste domínio.
      </p>
    );
  }

  return (
    <>
      <p role="status" className="sr-only">
        Erros de certificado carregados.
      </p>
      <ul
        className="list-none space-y-2 sm:max-h-96 sm:overflow-y-auto"
        role="list"
        aria-label="Erros de certificado"
      >
        {result.data.entries.map((entry, index) => (
          <CertificateLogEntry
            key={`${entry.time}-${entry.reason}-${index}`}
            entry={entry}
            {...target}
          />
        ))}
      </ul>
    </>
  );
}
