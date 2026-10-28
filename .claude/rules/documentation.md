# Comentários e documentação

Estas regras complementam o `CLAUDE.md` e têm a mesma prioridade.

## Comentários

- Comente o porquê, não o quê. Código claro não precisa de comentário explicando o que faz.
- Use comentários para decisões não óbvias, workarounds, limitações conhecidas e regras de negócio.
- Nunca deixe código comentado. Remova; o histórico fica no git.
- TODOs no formato `// TODO: <what and why>`, nunca vagos como `// TODO: fix`.
- Atualize ou remova comentários quando o código mudar. Comentário desatualizado é pior que nenhum.

## TSDoc

- Documente com TSDoc (`/** ... */`) toda API pública: funções, classes, métodos e tipos exportados pelo `index.ts` de cada módulo.
- Não documente funções privadas triviais; o nome e os tipos já explicam.
- Primeira linha: um resumo curto do que faz, no imperativo ou terceira pessoa ("Calculates the order total.").
- Use `@param` para cada parâmetro e `@returns` para o retorno, descrevendo o significado, não o tipo.
- Nunca repita os tipos nas tags (nada de `@param {string} name`). O TypeScript já declara os tipos.
- Use `@throws` para cada erro que a função pode lançar e em qual condição.
- Use `@example` em APIs públicas cujo uso não seja óbvio, com código que funcione de verdade.
- Use `@remarks` para detalhes longos, mantendo o resumo curto.
- Use `@deprecated` com a alternativa a usar no lugar.
- Valores monetários, unidades e limites devem ser explícitos na documentação (ex: "amount in cents", "between 0 and 100").

Exemplo:

```ts
/**
 * Applies a percentage discount to an order total.
 *
 * @param totalInCents - Order total in cents. Must be a non-negative integer.
 * @param discountPercent - Discount between 0 and 100.
 * @returns The discounted total in cents, rounded down.
 * @throws {InvalidDiscountError} When the discount is outside 0–100 or not finite.
 *
 * @example
 * applyDiscount(10_000, 15); // 8500
 */
export function applyDiscount(totalInCents: number, discountPercent: number): number {
```
