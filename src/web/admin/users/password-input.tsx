import { WandSparklesIcon } from "lucide-react";

import { CopyButton } from "@/web/components/layout/copy-button";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";

const GENERATED_PASSWORD_BYTES = 18;

/** Builds a strong random password in the browser with the Web Crypto API. */
function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GENERATED_PASSWORD_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** Password field with buttons to generate a strong password and copy it. */
export function PasswordInput({
  props,
  value,
  onChange,
}: {
  readonly props: { id: string; "aria-describedby": string; "aria-invalid": boolean };
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input
        {...props}
        className="font-mono sm:flex-1"
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => onChange(generatePassword())}>
          <WandSparklesIcon aria-hidden />
          Gerar senha
        </Button>
        {value === "" ? null : <CopyButton text={value} label="Copiar" />}
      </div>
    </div>
  );
}
