import { useForm } from "@tanstack/react-form";
import { useRef, useState } from "react";
import type { z } from "zod";

import type { domainInputSchema } from "@/shared/schemas/domain.schema";
import { useAction } from "@/web/components/layout/use-action";
import { addDomainFn } from "@/web/functions/domains.functions";

import { domainAddressSchema, parseDomainAddress } from "./domain-address";

/** Form state of a new domain, cleared after it is added. */
export function useAddDomainForm(projectId: string) {
  const httpsEdited = useRef(false);
  const [addressDetected, setAddressDetected] = useState(false);
  const add = useAction({
    action: (domain: z.output<typeof domainInputSchema>) =>
      addDomainFn({ data: { projectId, domain } }),
    successMessage: "Domínio adicionado",
    invalidate: [
      ["project", projectId],
      ["domains-dns", projectId],
    ],
    onSuccess: () => {
      form.reset();
      httpsEdited.current = false;
      setAddressDetected(false);
    },
  });
  const form = useForm({
    defaultValues: { hostname: "", httpsEnabled: true },
    validators: { onChange: domainAddressSchema },
    onSubmit: ({ value }) => {
      const address = parseDomainAddress(value.hostname);
      const domain = domainAddressSchema.parse(value);
      add.mutate({
        ...domain,
        httpsEnabled: httpsEdited.current
          ? domain.httpsEnabled
          : (address?.httpsEnabled ?? domain.httpsEnabled),
      });
    },
  });
  const detectAddress = (value: string): boolean => {
    const address = parseDomainAddress(value);
    if (address == null) {
      return false;
    }
    form.setFieldValue("hostname", address.hostname);
    if (address.httpsEnabled != null && httpsEdited.current === false) {
      form.setFieldValue("httpsEnabled", address.httpsEnabled);
    }
    if (address.httpsEnabled != null) {
      setAddressDetected(true);
    }
    return true;
  };
  const markHttpsEdited = () => {
    httpsEdited.current = true;
  };
  return { form, add, detectAddress, markHttpsEdited, addressDetected };
}

export type AddDomainFormApi = ReturnType<typeof useAddDomainForm>["form"];
