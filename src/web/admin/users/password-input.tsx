import { EyeIcon, EyeOffIcon, WandSparklesIcon } from "lucide-react";
import { useState } from "react";

import { CopyButton } from "@/web/components/layout/copy-button";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";

import { generateAccountPassword } from "./credentials/account-defaults";

/** Password field with buttons to generate a strong password and copy it. */
export function PasswordInput({
  props,
  value,
  onChange,
  readOnly,
}: {
  readonly props: { id: string; "aria-describedby": string | undefined; "aria-invalid": boolean };
  readonly value: string;
} & (
  | { readonly readOnly: true; readonly onChange?: never }
  | { readonly readOnly?: false; readonly onChange: (value: string) => void }
)) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        readOnly={readOnly}
        className="font-mono sm:flex-1"
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={visible}
          onClick={() => setVisible((current) => current === false)}
        >
          {visible ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
        </Button>
        {readOnly === true ? null : (
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(generateAccountPassword())}
          >
            <WandSparklesIcon aria-hidden />
            Gerar nova senha
          </Button>
        )}
        {value === "" ? null : <CopyButton text={value} label="Copiar senha" />}
      </div>
    </div>
  );
}
