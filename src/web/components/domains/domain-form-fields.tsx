import { cn } from "@/web/components/ui/class-names";
import { Input } from "@/web/components/ui/input";
import { Switch } from "@/web/components/ui/switch";

import type { AddDomainFormApi } from "./use-add-domain-form";

/** Hostname input with the scheme the HTTPS switch will serve shown in front of it. */
export function HostnameInput({
  form,
  error,
  onDetect,
  hintId,
}: {
  readonly form: AddDomainFormApi;
  /** Validation message shown below the form, or null when the hostname is valid. */
  readonly error: string | null;
  readonly onDetect: (value: string) => boolean;
  readonly hintId?: string | undefined;
}) {
  const describedBy = [hintId, error == null ? undefined : "domain-hostname-error"]
    .filter((id) => id != null)
    .join(" ");
  return (
    <div
      className={cn(
        "flex h-11 min-w-0 flex-1 items-center rounded-lg bg-secondary ring-1 ring-border transition-[box-shadow,background-color] ring-inset focus-within:bg-surface focus-within:ring-3 focus-within:ring-ring/25 hover:ring-input",
        error == null ? "" : "ring-destructive/60",
      )}
    >
      <form.Subscribe selector={(state) => state.values.httpsEnabled}>
        {(httpsEnabled) => (
          <span aria-hidden className="pl-3.5 font-mono text-sm text-faint select-none">
            {httpsEnabled ? "https://" : "http://"}
          </span>
        )}
      </form.Subscribe>
      <form.Field name="hostname">
        {(field) => (
          <Input
            id="domain-hostname"
            inputMode="url"
            autoCapitalize="none"
            placeholder="app.exemplo.com"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error != null}
            aria-describedby={describedBy === "" ? undefined : describedBy}
            className="h-full rounded-none bg-transparent pl-0.5 font-mono ring-0 hover:ring-0 focus-visible:bg-transparent focus-visible:ring-0"
            value={field.state.value}
            onBlur={() => {
              onDetect(field.state.value);
              field.handleBlur();
            }}
            onPaste={(event) => {
              if (onDetect(event.clipboardData.getData("text"))) {
                event.preventDefault();
              }
            }}
            onChange={(event) => field.handleChange(event.target.value)}
          />
        )}
      </form.Field>
    </div>
  );
}

export function HttpsSwitch({
  form,
  onEdited,
}: {
  readonly form: AddDomainFormApi;
  readonly onEdited: () => void;
}) {
  return (
    <form.Field name="httpsEnabled">
      {(field) => (
        <div className="flex items-center gap-2">
          <Switch
            id="domain-https"
            checked={field.state.value}
            onCheckedChange={(checked) => {
              onEdited();
              field.handleChange(checked);
            }}
            title="Certificado Let's Encrypt emitido automaticamente"
          />
          <label htmlFor="domain-https" className="text-sm">
            HTTPS
          </label>
        </div>
      )}
    </form.Field>
  );
}
