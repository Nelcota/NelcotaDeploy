import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import type { ProjectFormApi } from "@/web/components/forms/project-form";
import { Input } from "@/web/components/ui/input";

import { PROJECT_FORM_FIELDS } from "./project-validation";

/** Compose file of the repository and the service that receives the project's domains. */
export function ComposeFields({ form }: { readonly form: ProjectFormApi }) {
  return (
    <>
      <form.Field name="composeFilePath">
        {(field) => (
          <FormField
            {...PROJECT_FORM_FIELDS.composeFilePath}
            hint="Relativo à raiz do repositório."
            errors={visibleErrors(form, field.state.meta)}
          >
            {(props) => (
              <Input
                {...props}
                className="font-mono"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </FormField>
        )}
      </form.Field>
      <form.Field name="composeService">
        {(field) => (
          <FormField
            {...PROJECT_FORM_FIELDS.composeService}
            hint="O nome do serviço no arquivo, como web. A porta interna é a dele."
            errors={visibleErrors(form, field.state.meta)}
          >
            {(props) => (
              <Input
                {...props}
                className="font-mono"
                placeholder="web"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </FormField>
        )}
      </form.Field>
    </>
  );
}
