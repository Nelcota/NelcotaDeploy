# Performance

Estas regras complementam o `CLAUDE.md` e têm a mesma prioridade.

## Princípio

- Não otimize no escuro. Escreva primeiro o código simples e correto, evitando as armadilhas abaixo desde o início.
- Otimizações além disso só com medição: meça antes e depois com `Bun.nanoseconds()` ou o profiler (`bun --inspect`) e mostre os números. Se não houver ganho mensurável, mantenha a versão simples.
- Nunca troque legibilidade por micro-otimização sem medição que justifique.

## Banco de dados

- Nunca faça consultas N+1. Para buscar dados relacionados de vários registros, use JOIN ou `WHERE id IN (...)` numa única consulta.
- Toda listagem é paginada. Prefira paginação por cursor (`WHERE id > ? ORDER BY id LIMIT ?`) a `OFFSET`.
- Crie índices para colunas usadas em `WHERE`, `JOIN` e `ORDER BY`. Ao criar uma consulta nova, verifique se o índice existe.
- Selecione só as colunas necessárias. Nunca use `SELECT *`.
- Operações em lote (vários inserts ou updates) dentro de uma transação (`db.transaction()` no `bun:sqlite`).
- No `bun:sqlite`, use `db.query()`, que reaproveita o prepared statement, em vez de recriar a consulta a cada chamada.

## Async

- Operações de I/O independentes rodam em paralelo com `Promise.all` (ou `Promise.allSettled` quando falhas parciais são aceitáveis), não com `await` em sequência.
- `await` dentro de loop só quando cada passo depende do anterior.
- Nunca dispare paralelismo ilimitado. Para muitos itens, processe em lotes de tamanho fixo (ex: 10 por vez).
- Toda chamada de rede tem timeout (`AbortSignal.timeout()`).

## Estruturas de dados

- Para buscas repetidas, monte um `Map` ou `Set` antes do loop. Nunca `find`, `includes` ou `filter` dentro de um loop sobre outra lista (O(n²)).
- Nunca acumule com spread dentro de loop ou `reduce` (`acc = [...acc, item]`, `{ ...acc, [key]: value }`). Use `push` num array local, `Map` ou `Object.groupBy`.
- Prefira `some`, `find` e `includes`, que param no primeiro resultado, a `filter(...).length`.

## Memória e I/O

- Arquivos e respostas grandes via stream (`Bun.file(path).stream()`). Nunca leia arquivos grandes inteiros para a memória.
- Todo cache tem limite de tamanho e tempo de expiração. Cache sem limite é vazamento de memória.
- Limpe `setInterval`, `setTimeout`, listeners e conexões quando não forem mais necessários (prefira `using`).
- Não faça trabalho pesado na inicialização de módulos; carregue sob demanda.

## HTTP

- Respostas cacheáveis com `Cache-Control` e `ETag` adequados.
- Ative compressão para respostas de texto (HTML, JSON, CSS, JS).
- Limite o tamanho do corpo das requisições e o número de itens por página.
- Arquivos estáticos servidos diretamente com `new Response(Bun.file(path))`.

## Interfaces web

- Imagens com `width` e `height` definidos e `loading="lazy"` quando estiverem abaixo da primeira tela.
- Prefira formatos modernos de imagem (AVIF, WebP) e tamanhos adequados à exibição.
- Não carregue JavaScript que a página não usa. Carregue sob demanda o que não é necessário na primeira tela.
