import { useQuery } from "@tanstack/react-query";
import { WebhookIcon } from "lucide-react";

import { List, Section } from "@/web/components/layout/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { listWebhookDeliveriesFn } from "@/web/functions/admin/audit.functions";

import { type WebhookDelivery, WebhookDeliveryRow } from "./webhook-delivery-row";

const SKELETON_ROWS = 2;

function DeliveryListBody({
  deliveries,
  isError,
}: {
  readonly deliveries: readonly WebhookDelivery[] | undefined;
  readonly isError: boolean;
}) {
  if (deliveries == null) {
    return isError ? null : <ListSkeleton rows={SKELETON_ROWS} />;
  }
  if (deliveries.length === 0) {
    return <EmptyState icon={WebhookIcon} title="Nenhum webhook recebido ainda" />;
  }
  return (
    <List>
      {deliveries.map((delivery) => (
        <WebhookDeliveryRow key={delivery.id} delivery={delivery} />
      ))}
    </List>
  );
}

/** Latest GitHub webhook deliveries with a valid signature. */
export function WebhookDeliveriesSection() {
  const deliveries = useQuery({
    queryKey: ["webhook-deliveries"],
    queryFn: () => listWebhookDeliveriesFn(),
  });
  return (
    <Section
      icon={WebhookIcon}
      title="Webhooks recebidos"
      description="Entregas do GitHub com assinatura válida, deduplicadas pelo identificador de entrega."
    >
      {deliveries.isError ? (
        <ErrorState error={deliveries.error} onRetry={() => void deliveries.refetch()} />
      ) : null}
      <DeliveryListBody deliveries={deliveries.data} isError={deliveries.isError} />
    </Section>
  );
}
