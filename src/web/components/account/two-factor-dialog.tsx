import { LoaderCircleIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { CopyButton } from "@/web/components/layout/copy-button";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

import { authenticatorSecret } from "./authenticator-secret";
import { useTwoFactor } from "./use-two-factor";

const ERROR_ID = "two-factor-setup-error";

/** One labelled input with the dialog's error under it and a submit button. */
function SingleFieldForm({
  id,
  label,
  type,
  submitLabel,
  error,
  pending,
  onSubmit,
}: {
  readonly id: string;
  readonly label: string;
  readonly type: "password" | "code";
  readonly submitLabel: string;
  readonly error: string | null;
  readonly pending: boolean;
  readonly onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value);
  };
  return (
    <form className="space-y-3" onSubmit={submit} noValidate>
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type={type === "password" ? "password" : "text"}
          inputMode={type === "code" ? "numeric" : undefined}
          autoComplete={type === "password" ? "current-password" : "one-time-code"}
          className={type === "code" ? "font-mono tracking-widest" : undefined}
          aria-invalid={error != null}
          aria-describedby={error == null ? undefined : ERROR_ID}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <p id={ERROR_ID} aria-live="polite" className="text-sm text-destructive empty:hidden">
        {error ?? ""}
      </p>
      <Button type="submit" disabled={pending || value.trim() === ""}>
        {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}

function AuthenticatorKey({ totpUri }: { readonly totpUri: string }) {
  const secret = authenticatorSecret(totpUri);
  return (
    <div className="space-y-2 rounded-xl bg-well/60 p-4">
      <p className="text-sm">
        No app autenticador (Google Authenticator, 1Password, Authy…), adicione uma conta com esta
        chave:
      </p>
      <p className="font-mono text-base font-semibold tracking-wider break-all">
        {secret ?? "Chave indisponível"}
      </p>
      <div className="flex flex-wrap gap-2">
        {secret == null ? null : (
          <CopyButton text={secret.replaceAll(" ", "")} label="Copiar chave" />
        )}
        <Button variant="outline" size="sm" asChild>
          <a href={totpUri}>Abrir no app do celular</a>
        </Button>
      </div>
    </div>
  );
}

function RecoveryCodes({
  codes,
  onDone,
}: {
  readonly codes: readonly string[];
  readonly onDone: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Guarde estes códigos de recuperação num lugar seguro. Cada um entra uma vez, se você perder
        o celular. Eles não serão mostrados de novo.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-xl bg-well/60 p-4 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={codes.join("\n")} label="Copiar códigos" />
        <Button onClick={onDone}>Concluir</Button>
      </div>
    </div>
  );
}

function DialogBody({
  enabled,
  onFinished,
}: {
  readonly enabled: boolean;
  readonly onFinished: () => void;
}): ReactNode {
  const { step, error, pending, enable, confirm, disable, finish } = useTwoFactor(onFinished);
  if (enabled && step.kind === "password") {
    return (
      <SingleFieldForm
        id="two-factor-disable-password"
        label="Sua senha"
        type="password"
        submitLabel="Desativar"
        error={error}
        pending={pending}
        onSubmit={(password) => void disable(password)}
      />
    );
  }
  switch (step.kind) {
    case "password":
      return (
        <SingleFieldForm
          id="two-factor-enable-password"
          label="Sua senha"
          type="password"
          submitLabel="Continuar"
          error={error}
          pending={pending}
          onSubmit={(password) => void enable(password)}
        />
      );
    case "setup":
      return (
        <div className="space-y-4">
          <AuthenticatorKey totpUri={step.totpUri} />
          <SingleFieldForm
            id="two-factor-confirm-code"
            label="Código de 6 dígitos que o app mostra"
            type="code"
            submitLabel="Ativar"
            error={error}
            pending={pending}
            onSubmit={(code) => void confirm(code, step.backupCodes)}
          />
        </div>
      );
    case "codes":
      return <RecoveryCodes codes={step.backupCodes} onDone={() => void finish()} />;
  }
}

/** Dialog where the signed-in user turns two-factor authentication on or off. */
export function TwoFactorDialog({
  enabled,
  open,
  onOpenChange,
}: {
  /** The user already has two-factor authentication. */
  readonly enabled: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verificação em duas etapas</DialogTitle>
          <DialogDescription>
            {enabled
              ? "Ativa: além da senha, o login pede um código do app autenticador. Para desativar, confirme sua senha."
              : "Além da senha, o login passa a pedir um código do app autenticador. Com ela ativa, o login com GitHub fica desligado para esta conta."}
          </DialogDescription>
        </DialogHeader>
        {open ? <DialogBody enabled={enabled} onFinished={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
