import { FingerprintIcon, GlobeIcon, HeartPulseIcon } from "lucide-react";
import type { ReactNode } from "react";

import { formatTimeAgo } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";

import type { ServerView } from "./use-servers";

function Fact({
  icon: Icon,
  label,
  children,
}: {
  readonly icon: typeof GlobeIcon;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
        {label}
      </dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  );
}

/** Address for DNS, last contact and pinned SSH host key of a remote server. */
export function ServerFacts({ server }: { readonly server: ServerView }) {
  const now = useNow();
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <Fact icon={GlobeIcon} label="IP para o DNS">
        {server.publicAddress == null ? (
          "Ainda não detectado"
        ) : (
          <span className="font-mono">{server.publicAddress}</span>
        )}
      </Fact>
      <Fact icon={HeartPulseIcon} label="Última conexão">
        {formatTimeAgo(server.lastSeenAt ?? undefined, now)}
      </Fact>
      {server.hostKeyFingerprint == null ? null : (
        <Fact icon={FingerprintIcon} label="Impressão digital SSH">
          <span className="font-mono" title={server.hostKeyFingerprint}>
            {server.hostKeyFingerprint}
          </span>
        </Fact>
      )}
    </dl>
  );
}
