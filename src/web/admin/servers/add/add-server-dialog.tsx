import { ServerIcon } from "lucide-react";

import { DialogFormFooter } from "@/web/admin/dialog-form-footer";
import { FormField, visibleErrors } from "@/web/components/forms/form-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
}: {
  readonly form: AddServerFormApi;
  readonly name: TextFieldName;
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly inputMode?: "numeric";
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
              placeholder={placeholder}
              inputMode={inputMode}
              autoComplete="off"
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

/** Port and account, which rarely change from the defaults. */
function AdvancedFields({ form }: { readonly form: AddServerFormApi }) {
  return (
    <details className="group rounded-lg ring-1 ring-border/70">
      <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
        Avançado
      </summary>
      <div className="space-y-4 px-3 pt-1 pb-3">
        <TextField form={form} name="port" label="Porta SSH" inputMode="numeric" />
        <TextField
          form={form}
          name="username"
          label="Usuário"
          hint="Conta que o comando de instalação cria e que o painel usa."
        />
      </div>
    </details>
  );
}

/** Dialog that registers a VPS; the panel connects to it on its own after the install. */
export function AddServerDialog({ onClose }: { readonly onClose: () => void }) {
  const { form, isPending } = useAddServerForm(onClose);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar servidor</DialogTitle>
          <DialogDescription>
            Uma VPS Linux (Ubuntu ou Debian) para rodar aplicações. Depois de adicionar, rode o
            comando de instalação nela uma vez; o painel faz o resto sozinho.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <TextField form={form} name="name" label="Nome" placeholder="aplicacoes-1" />
          <TextField
            form={form}
            name="host"
            label="IP ou domínio"
            hint="O endereço que você usa para acessar a VPS por SSH."
            placeholder="203.0.113.10"
          />
          <AdvancedFields form={form} />
          <DialogFormFooter
            submitLabel="Adicionar"
            isPending={isPending}
            onCancel={onClose}
            idleIcon={<ServerIcon aria-hidden />}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
