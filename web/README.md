# Interface do painel

O shell HTML em `routes.go` usa escape automático de `html/template`. CSS e JavaScript em `assets/` são embutidos no binário, identificados por hash e pré-comprimidos com gzip uma vez na inicialização. São servidos com cache immutable, ETags separados por representação e negociação de encoding. CSP não permite scripts ou estilos inline, CDNs, objetos ou frames.

O JavaScript usa as APIs de `internal/service` através do roteador, DOM seguro com textContent e conexões SSE compartilhadas por tópico. Não possui regras de autorização próprias: esconder controles de admin é apenas UX; os serviços autorizam todas as operações. Não persistir segredos, cookies, CSRF ou desafios no armazenamento do navegador.

A implementação inicial usa a alternativa da biblioteca padrão já admitida pelo contrato, para entregar os fluxos sem acrescentar frameworks/dependências de produção. Uma migração futura para templ/Datastar/Tailwind deve preservar contratos, segurança e testes.

`make build` incorpora as alterações da interface. QA: `npm ci`, `npx playwright install --with-deps chromium`, `make check-web test-browser`. Consulte `docs/contrato-frontend.md` e `docs/entrega-revisoes.md`.
