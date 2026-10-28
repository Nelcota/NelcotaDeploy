# Minhas preferências de código

Estas regras valem para todo código que você escrever ou alterar.
Elas têm prioridade sobre qualquer outra instrução de estilo, inclusive
sobre instruções de skills como o Ponytail para reduzir código.

Regras complementares (mesma prioridade):

@.claude/rules/documentation.md
@.claude/rules/testing.md
@.claude/rules/git.md
@.claude/rules/web-ui.md
@.claude/rules/performance.md
@.claude/rules/sanitization.md
@.claude/rules/security.md

## Comportamento

- Prefira sempre a solução mais simples que resolve o problema atual. Não antecipe necessidades futuras que ninguém pediu.
- Não altere código que não tem relação com a tarefa pedida.
- Antes de uma mudança grande ou de reestruturar código existente, explique o plano e espere minha aprovação.
- Não adicione dependências novas sem perguntar antes.

## Verificação

- Antes de dizer que terminou, rode `bun run check` (formatação, Oxlint, tipos, Knip e testes) e corrija o que falhar.
- Não formate código manualmente nem discuta estilo de formatação: rode `bun run format` e deixe o Oxfmt decidir.
- Se o Knip apontar arquivos, exports ou dependências sem uso que você criou, remova-os. Se forem de antes da sua tarefa, me avise em vez de apagar.
- Nunca desative regras do linter (`oxlint-disable`, `eslint-disable`), nem use `@ts-ignore` ou `@ts-expect-error`, para fazer o código passar. Corrija o código. Se achar que uma regra está errada no caso, me pergunte.
- Nunca apague ou enfraqueça um teste para fazê-lo passar.
- Lógica com condição, loop, cálculo, parsing, dinheiro ou segurança deve ter pelo menos um teste.
- Ao final, diga o que foi verificado e o que não foi.

## Runtime: Bun

- Use Bun como runtime e gerenciador de pacotes. Nunca use node, npm, npx, yarn ou pnpm.
- Comandos: `bun install`, `bun add`, `bun run`, `bun test`, `bunx`.
- Use o test runner nativo (`bun:test`). Não instale Jest ou Vitest.
- Rode TypeScript direto com Bun. Não instale ts-node, tsx nem configure build só para executar código.
- Prefira as APIs nativas do Bun quando fizerem sentido: `Bun.serve`, `Bun.file`, `bun:sqlite`, `Bun.password`, `Bun.$`, `Bun.escapeHTML`.
- Não instale pacotes para algo que o Bun já faz nativamente (exemplo: dotenv, pois o Bun já carrega .env).

## Versões e dependências

- Use sintaxe e APIs modernas (async/await, ES modules, fetch nativo). Evite padrões legados.
- Prefira a versão estável mais recente das dependências, mas não use versões publicadas há menos de 14 dias (o `bunfig.toml` do projeto já bloqueia isso na instalação).
- Respeite as peerDependencies: não atualize um pacote para uma versão que quebre outro (ex: o TypeScript deve continuar compatível com o `oxlint-tsgolint`).
- Use versões exatas no `package.json`, sem `^` ou `~` (o `bunfig.toml` já salva assim).
- Se você não conhece bem a versão mais recente de uma biblioteca, consulte a documentação oficial antes de usar a API. Não invente métodos.
- Rode `bun audit` ao adicionar ou atualizar dependências e me avise sobre vulnerabilidades.

## TypeScript

- Use `strict: true`.
- Nunca use non-null assertion (`valor!`). Faça a checagem real ou use `?.`.
- Evite `any`. Se o tipo for desconhecido, use `unknown` e valide.
- Ao acessar arrays e objetos por índice, trate o resultado como possivelmente `undefined` (o tsconfig usa `noUncheckedIndexedAccess`).
- Use só sintaxe TypeScript que some ao remover os tipos (o tsconfig usa `erasableSyntaxOnly`):
  - Nada de `enum`: use um objeto `as const` ou uma união de strings (`type Status = "pending" | "paid"`).
  - Nada de `namespace`: use módulos.
  - Nada de parameter properties (`constructor(private name: string)`): declare a propriedade e atribua no construtor.
- Use `satisfies` para validar um objeto contra um tipo sem perder a inferência.

## JavaScript moderno

- Não mute arrays: use `toSorted()`, `toReversed()`, `toSpliced()` e `with()` em vez de `sort()`, `reverse()`, `splice()` e atribuição por índice.
- Use `Object.groupBy()` e `Map.groupBy()` em vez de agrupar com `reduce`.
- Use `structuredClone()` para cópias profundas. Nunca `JSON.parse(JSON.stringify(...))`.
- Use os métodos de `Set` (`union`, `intersection`, `difference`, `isSubsetOf`) em vez de reimplementá-los.
- Use `using` / `await using` para recursos que precisam ser fechados (conexões, arquivos, locks), em vez de `try/finally` manual.
- Use `Array.prototype.at(-1)` para o último elemento, `Object.hasOwn()` em vez de `hasOwnProperty`, e `Promise.withResolvers()` quando precisar resolver uma Promise de fora.
- Use `Array.fromAsync()` para coletar iteráveis assíncronos e `AbortSignal.timeout()` para timeouts em `fetch`.

## Async

- Use async/await para qualquer operação de I/O (rede, arquivo, banco de dados).
- Funções sem I/O (cálculos, formatações) não devem ser async.
- Nunca deixe uma Promise sem await ou sem tratamento de erro.

## Validações (obrigatórias)

- Valide null/undefined em todo valor que pode faltar pelo tipo (`T | null`, `T | undefined`, propriedades opcionais) ou que vem de fora do sistema. Não cheque null em valores que o TypeScript já garante.
- Verifique strings vazias (incluindo só espaços) e arrays vazios antes de processar.
- Valide limites numéricos (mínimo, máximo, negativos) quando o valor vem de fora ou entra num cálculo.
- Proteja contra NaN e Infinity: use `Number.isFinite` após conversões e divisões.
- Essas validações nunca devem ser removidas para reduzir código.

## Early return

- Valide no início da função e saia cedo, em vez de aninhar ifs.
- Não use else depois de um return.
- Evite mais de 2 níveis de aninhamento.
- Retorne cedo quando o caso é esperado. Lance erro quando o caso nunca deveria acontecer. Não esconda bugs com returns silenciosos.

## Erros

- Nunca deixe um catch vazio nem engula erros silenciosamente.
- Mensagens de erro devem dizer o que deu errado e com qual valor, sem expor dados sensíveis.
- Crie classes de erro específicas por módulo quando fizer sentido (ex: `InvalidOrderError`).

## Nomes e idiomas

- Identificadores (variáveis, funções, classes, arquivos) em inglês.
- Comentários e documentação (TSDoc) sempre em inglês. Nunca escreva comentários em português.
- Mensagens de commit sempre em inglês.
- Logs e mensagens de erro internas (throw, console, logs de servidor) em inglês.
- Todo texto visível nas interfaces web em português do Brasil.
- Nomes claros e descritivos, mesmo que longos. Evite abreviações.
- Classes de erro terminam em `Error` (ex: `InvalidOrderError`).

## Legibilidade

- Não use o operador `!` para negação. Prefira comparações explícitas ou funções com nomes descritivos:
  - `valor == null` em vez de `!valor`
  - `lista.length === 0` em vez de `!lista.length`
  - `texto.trim() === ""` em vez de `!texto`
  - `Number.isFinite(total) === false` em vez de `!Number.isFinite(total)`
  - `isEmpty(items)` em vez de `!hasItems(items)`
- O operador `!==` é permitido; a regra vale só para o `!` de negação.
- Legibilidade vem antes de esperteza: não comprima lógica em one-liners difíceis de ler, ternários aninhados ou encadeamentos longos.

## Simplicidade

- Não crie interfaces, classes abstratas ou genéricos com uma única implementação.
- Não crie camadas extras (wrappers, adapters, managers, helpers) sem um motivo concreto.
- Funções pequenas, com uma responsabilidade só. Se precisa de "e" para descrever o que ela faz, divida.

## Dados

- Use const por padrão e readonly em propriedades que não mudam. Não mute parâmetros recebidos.
- Valores monetários em centavos como inteiro, nunca float.
- Não use números mágicos: dê nome às constantes (ex: `MAX_DISCOUNT = 100`).
- Datas: armazene e trafegue sempre em UTC (ISO 8601, ex: `2026-10-24T14:30:00Z`). Converta para o fuso do usuário só na exibição.
- Nunca use `new Date("dd/mm/yyyy")` nem parse de datas em formato local. Valide toda data convertida com `Number.isNaN(date.getTime())`.
- Durações em unidades explícitas no nome (`timeoutInMs`, `ttlInSeconds`).

## Padrões de projeto

- Use Builder para objetos com muitos campos opcionais ou construção em etapas. Valide tudo no `build()` e lance erro se algo estiver inválido.
- Para objetos simples (poucos campos, todos obrigatórios), prefira uma função com parâmetros nomeados.
- Use Strategy quando houver variações de um mesmo comportamento (ex: formas de pagamento, cálculo de frete), em vez de if/switch crescendo.
- Use Factory quando a criação de um objeto depende de uma condição (ex: criar o tipo certo de notificação).
- Não aplique um padrão sem necessidade real. Se uma função simples resolve, use a função.

## Organização

Trate cada pasta de funcionalidade como um package: coeso, com fronteira clara e API pública definida.

### Estrutura

- Organize o código por funcionalidade (ex: `src/orders/`, `src/customers/`), não por tipo de arquivo (nada de `src/services/`, `src/models/`, `src/controllers/` na raiz).
- Antes de criar um arquivo, veja a estrutura existente e coloque-o no package da funcionalidade a que pertence.
- Nunca crie arquivos ou classes soltos na raiz de `src/`. Se não há package adequado, proponha um novo e explique antes de criar.
- Quando um package passar de ~10 arquivos, divida em sub-packages por assunto (ex: `orders/payment/`, `orders/shipping/`).

Exemplo:

```
src/
  orders/
    index.ts              # API pública do package
    order.ts
    order.builder.ts
    order.service.ts
    order.service.test.ts
    order.errors.ts
    order-item.ts
    payment/
      payment.strategy.ts
      pix.strategy.ts
      credit-card.strategy.ts
  customers/
    index.ts
    ...
  shared/
    validation.ts
    dates.ts
  main.ts                 # único arquivo permitido na raiz de src/
```

### Arquivos

- Uma classe por arquivo. Tipos, constantes e funções auxiliares que só ela usa podem ficar no mesmo arquivo. Exceção: as classes de erro de um package ficam juntas no `<nome>.errors.ts`.
- Nomes de arquivo em kebab-case, com o papel como sufixo após um ponto: `order.service.ts`, `order-item.builder.ts`, `credit-card.strategy.ts`, `order.errors.ts`, `order.types.ts`.
- Testes ficam ao lado do arquivo testado: `order.service.test.ts`.

### Fronteiras

- Cada package expõe sua API pública por um `index.ts`. Outros packages importam só pelo index, nunca de arquivos internos.
- Use um `index.ts` por package de funcionalidade, não um por sub-package interno.
- Dentro de um package, sub-packages se comunicam pelo package pai: `orders/payment/` não importa direto de `orders/shipping/` (o linter bloqueia). Se precisarem compartilhar algo, isso sobe para a raiz do package.
- Exporte no `index.ts` só o que outros packages realmente usam. O resto é interno.
- Não crie dependências circulares entre packages. Se dois packages precisam um do outro, a parte comum vai para um terceiro ou para `src/shared/`.
- `src/shared/` é só para código usado por dois ou mais packages, organizado por assunto. Nunca crie um `utils.ts` ou `helpers.ts` genérico.
- Não crie uma classe nova se a responsabilidade cabe numa classe existente do mesmo package.
