import { Checkbox } from "@/web/components/ui/checkbox";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

import type { TemplateVariableDraft } from "./template-draft";

function draftHint(draft: TemplateVariableDraft): string {
  if (draft.generated) {
    return "Secret gerado automaticamente para esta aplicação.";
  }
  if (draft.kind === "secret") {
    return "A credencial precisa ser fornecida; o valor de exemplo não será usado.";
  }
  return "Confira o valor sugerido antes de aplicar.";
}

export function TemplateVariableRow({
  draft,
  onChange,
}: {
  readonly draft: TemplateVariableDraft;
  readonly onChange: (draft: TemplateVariableDraft) => void;
}) {
  const id = `template-${draft.key}`;
  return (
    <div className="space-y-2 rounded-lg p-3 ring-1 ring-border">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-selected`}
          checked={draft.selected}
          onCheckedChange={(checked) => onChange({ ...draft, selected: checked === true })}
        />
        <Label htmlFor={`${id}-selected`} className="font-mono break-all">
          {draft.key}
        </Label>
      </div>
      <Label htmlFor={id} className="sr-only">
        Valor de {draft.key}
      </Label>
      <Input
        id={id}
        type={draft.kind === "secret" ? "password" : "text"}
        value={draft.value}
        disabled={draft.selected === false}
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
        placeholder={
          draft.kind === "secret"
            ? "Informe sua credencial ou desmarque a variável"
            : "Valor sugerido pelo arquivo de exemplo"
        }
        onChange={(event) => onChange({ ...draft, value: event.target.value, generated: false })}
      />
      <p className="text-xs text-muted-foreground">{draftHint(draft)}</p>
    </div>
  );
}
