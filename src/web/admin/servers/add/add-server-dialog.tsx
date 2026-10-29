import { LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import { Button } from "@/web/components/ui/button";
import { cn } from "@/web/components/ui/class-names";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";

import { type AddServerFormApi, useAddServerForm } from "./use-add-server-form";

type TextFieldName = "name" | "host" | "port" | "username";

function TextField({
  form,
  name,
  label,
  hint,
  placeholder,
  inputMode,
  monospace = false,
}: {
  readonly form: AddServerFormApi;
  readonly name: TextFieldName;
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly inputMode?: "numeric";
  readonly monospace?: boolean;
}) {
  return (
    <form.Field name={name}>
      {(field) => (
        <FormField
          id={`server-${name}`}
          label={label}
          hint={hint}
          errors={visibleErrors(form, field.state.meta)}
        >
          {(props) => (
            <Input
              {...props}
              className={cn(monospace && "font-mono")}
              placeholder={placeholder}
              inputMode={inputMode}
              autoComplete="off"
              spellCheck={false}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </FormField>
      )}
    </form.Field>
  );
}

/**
 * Port and account, which rarely change: a summary of the current values that opens into
 * their fields.
 */
function SshSettings({ form }: { readonly form: AddServerFormApi }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="rounded-xl ring-1 ring-border/70 ring-inset">
      <div className="flex items-center justify-between gap-6 px-4 py-3.5">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">Conexão SSH</p>
          <form.Subscribe selector={(state) => [state.values.port, state.values.username] as const}>
            {([port, username]) => (
              <p className="truncate text-xs text-muted-foreground">
                Porta <span className="font-mono">{port}</span> · usuário{" "}
                <span className="font-mono">{username}</span>
              </p>
            )}
          </form.Subscribe>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={editing}
          aria-controls="server-ssh-fields"
          onClick={() => setEditing((open) => open === false)}
        >
          {editing ? "Fechar" : "Alterar"}
        </Button>
      </div>
      {editing ? (
        <div
          id="server-ssh-fields"
          className="grid gap-4 border-t border-border/70 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
        >
          <TextField form={form} name="port" label="Porta" inputMode="numeric" monospace />
          <TextField
            form={form}
            name="username"
            label="Usuário"
            hint="Conta que o comando de instalação cria e o painel usa."
            monospace
          />
        </div>
      ) : null}
    </div>
  );
}

function AddServerFooter({
  isPending,
  onCancel,
}: {
  readonly isPending: boolean;
  readonly onCancel: () => void;
}) {
  return (
    <DialogFooter>
      <p className="mr-auto hidden self-center text-xs text-muted-foreground sm:block">
        Ubuntu ou Debian, com acesso root.
      </p>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancelar
      </Button>
      <Button type="submit" disabled={isPending}>
        {isPending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
        Adicionar servidor
      </Button>
    </DialogFooter>
  );
}

/** Dialog that registers a VPS; the panel connects to it on its own after the install. */
export function AddServerDialog({ onClose }: { readonly onClose: () => void }) {
  const { form, isPending } = useAddServerForm(onClose);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adicionar servidor</DialogTitle>
          <DialogDescription>
            Uma VPS Linux para rodar aplicações. Em seguida você recebe um comando para colar nela
            uma única vez.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <TextField
              form={form}
              name="name"
              label="Nome"
              hint="Só para você reconhecer."
              placeholder="aplicacoes-1"
            />
            <TextField
              form={form}
              name="host"
              label="IP ou domínio"
              hint="Por onde você acessa a VPS via SSH."
              placeholder="203.0.113.10"
              monospace
            />
          </div>
          <SshSettings form={form} />
          <AddServerFooter isPending={isPending} onCancel={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
