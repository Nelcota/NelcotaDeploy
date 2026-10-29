import { PlusIcon } from "lucide-react";

import { errorMessages, visibleErrors } from "@/web/components/forms/form-field";
import { Button } from "@/web/components/ui/button";

import { HostnameInput, HttpsSwitch } from "./domain-form-fields";
import { useAddDomainForm } from "./use-add-domain-form";

/** Inline form at the top of the domain list: hostname, HTTPS switch and submit. */
export function AddDomainForm({ projectId }: { readonly projectId: string }) {
  const { form, add } = useAddDomainForm(projectId);
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
        Adicionar domínio
      </label>
      <form.Field name="hostname">
        {(field) => {
          const [error] = errorMessages(visibleErrors(form, field.state.meta));
          return (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <HostnameInput form={form} error={error ?? null} />
                <HttpsSwitch form={form} />
                <Button type="submit" disabled={add.isPending || field.state.value.trim() === ""}>
                  <PlusIcon aria-hidden />
                  Adicionar
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
    </form>
  );
}
