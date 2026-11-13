import { PlusIcon } from "lucide-react";

import { errorMessages, visibleErrors } from "@/web/components/forms/form-field";
import { Button } from "@/web/components/ui/button";

import { HostnameInput, HttpsSwitch } from "./domain-form-fields";
import { useAddDomainForm } from "./use-add-domain-form";

/** Inline form at the top of the domain list: hostname, HTTPS switch and submit. */
export function AddDomainForm({
  projectId,
  firstDomain = false,
}: {
  readonly projectId: string;
  readonly firstDomain?: boolean;
}) {
  const { form, add, detectAddress, markHttpsEdited, addressDetected } =
    useAddDomainForm(projectId);
  const submitLabel = firstDomain ? "Salvar domínio" : "Adicionar domínio";
  return (
    <form
      noValidate
      className="space-y-2 bg-well/40 px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      aria-label="Adicionar domínio"
    >
      <label htmlFor="domain-hostname" className="text-sm font-medium">
        {firstDomain ? "Endereço do app" : "Adicionar domínio"}
      </label>
      {firstDomain ? (
        <p id="domain-hostname-hint" className="text-sm text-muted-foreground">
          Use um domínio que você controla, como app.exemplo.com.
        </p>
      ) : null}
      <form.Field name="hostname">
        {(field) => {
          const [error] = errorMessages(visibleErrors(form, field.state.meta));
          return (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <HostnameInput
                  form={form}
                  error={error ?? null}
                  onDetect={detectAddress}
                  hintId={firstDomain ? "domain-hostname-hint" : undefined}
                />
                <HttpsSwitch form={form} onEdited={markHttpsEdited} />
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={add.isPending || field.state.value.trim() === ""}
                >
                  <PlusIcon aria-hidden />
                  {add.isPending ? "Salvando…" : submitLabel}
                </Button>
              </div>
              <p
                id="domain-hostname-error"
                aria-live="polite"
                className="text-xs font-medium text-destructive empty:hidden"
              >
                {error ?? ""}
              </p>
            </>
          );
        }}
      </form.Field>
      {addressDetected ? (
        <p role="status" className="text-xs text-muted-foreground">
          Domínio extraído do endereço. Caminhos e parâmetros da URL não serão configurados.
        </p>
      ) : null}
    </form>
  );
}
