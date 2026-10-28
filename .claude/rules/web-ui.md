# Interfaces web

Estas regras complementam o `CLAUDE.md` e têm a mesma prioridade.

## Idioma e formatação (pt-BR)

- Todo texto visível na interface em português do Brasil: botões, labels, títulos, placeholders, mensagens de erro e de validação, textos alternativos.
- Nunca mostre erros internos (em inglês) ao usuário. Traduza para uma mensagem amigável em português.
- Dinheiro: `new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`, convertendo de centavos só na exibição (`cents / 100`).
- Números: `Intl.NumberFormat("pt-BR")` (vírgula decimal, ponto de milhar).
- Datas: `Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" })` no formato dd/mm/aaaa. Converta de UTC só na exibição.
- Crie as instâncias de `Intl` uma vez em `src/shared/format.ts` e reutilize; não espalhe formatação pelo código.
- Entradas do usuário em formato brasileiro (ex: "1.234,56") devem ser convertidas e validadas contra NaN antes de usar.

## Acessibilidade

- Use HTML semântico: `button` para ações, `a` para navegação, `nav`, `main`, `header`, `form`. Nunca `div` clicável.
- Todo campo de formulário tem um `label` associado. Placeholder não substitui label.
- Toda imagem informativa tem `alt` descritivo em português; imagens decorativas usam `alt=""`.
- Tudo deve funcionar só com teclado, com foco visível. Não remova o `outline` sem um substituto.
- Mensagens de erro de formulário ligadas ao campo com `aria-describedby` e anunciadas com `aria-live` quando aparecerem dinamicamente.
- Contraste mínimo WCAG AA (4,5:1 para texto normal). Não use só cor para transmitir informação.
- Defina `<html lang="pt-BR">`.
- Use ARIA só quando o HTML semântico não resolver.
