import { Input } from "@/web/components/ui/input";

import { FormField, visibleErrors } from "../form-field";
import type { ProjectFormApi } from "../project-form";
import { PROJECT_FORM_FIELDS } from "../project-validation";
import type { ProjectAutomation } from "./use-project-automation";

/** Editable field backed by repository suggestions; selecting or typing makes it user-owned. */
export function DetectedProjectField({
  form,
  automation,
  name,
  hint,
  suggestions,
}: {
  readonly form: ProjectFormApi;
  readonly automation: ProjectAutomation;
  readonly name: "branch" | "dockerfilePath" | "buildContext";
  readonly hint: string;
  readonly suggestions: readonly string[];
}) {
  const { id, label } = PROJECT_FORM_FIELDS[name];
  return (
    <form.Field name={name}>
      {(field) => (
        <FormField id={id} label={label} hint={hint} errors={visibleErrors(form, field.state.meta)}>
          {(props) => (
            <>
              <Input
                {...props}
                list={`${id}-options`}
                className="font-mono"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  automation.markEdited(name);
                  field.handleChange(event.target.value);
                }}
              />
              <datalist id={`${id}-options`}>
                {suggestions.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </>
          )}
        </FormField>
      )}
    </form.Field>
  );
}
