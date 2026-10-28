# Testes

Estas regras complementam o `CLAUDE.md` e têm a mesma prioridade.

- Use `bun:test` (`describe`, `test`, `expect`). Arquivos de teste ao lado do arquivo testado: `order.service.test.ts`.
- Teste comportamento, não implementação: verifique o que a função entrega, não como ela faz por dentro.
- Um cenário por teste. Nome descritivo em inglês dizendo a condição e o resultado esperado: `test("throws InvalidDiscountError when discount is above 100")`.
- Estrutura Arrange, Act, Assert, com uma linha em branco separando cada parte.
- Cubra o caminho feliz e os casos de borda das suas validações: null, vazio, zero, negativo, limite máximo, NaN.
- Para cada `@throws` documentado, deve existir um teste que provoca esse erro.
- Testes independentes entre si: nada de estado compartilhado nem ordem de execução importando.
- Não use mock para código do próprio projeto quando for possível usar o código real. Use mock só para fronteiras externas (rede, relógio, serviços de terceiros).
- Para datas, injete o relógio ou use `setSystemTime` do `bun:test`. Nunca dependa da data real.
- Nunca apague, pule (`test.skip`) ou enfraqueça um teste para fazê-lo passar.
