# Progresso do backend

Fonte: `docs/Nelcota Deploy.md`, lido integralmente em 2026-10-15. `AGENTS.md` e `docs/plano.md` não existem no checkout recebido.

- [x] 1. Esqueleto, toolchain Go 1.26, Makefile e CI
- [ ] 2. Protocolo tipado, ConnectRPC, mTLS, assinatura, heartbeat e reconexão
- [ ] 3. Pipeline do agent e reconciliação
- [ ] 4. SQLite, serviços, GitHub e fila
- [ ] 5. Logs, eventos e persistência zstd
- [ ] 6. Autenticação e segurança do servidor
- [ ] 7. Instaladores e guia de VPS
- [ ] 8. Benchmarks, medição e relatório

## Ambiente inicial

Diretório contém apenas o plano. Não há Go, Docker, shellcheck ou golangci-lint no PATH. `.git` é um diretório vazio somente leitura. Ferramentas serão preparadas em `/tmp`; limitações serão documentadas sem substituir testes reais por resultados simulados.

## Marco 1
Go 1.26.9 oficial verificado. Build estático, testes com goleak e lint (vet, golangci-lint, shellcheck) passaram. CI inclui race, geração reproduzível e integração. Docker ausente: integração externa registrada. Autorrevisão: sem segredos ou binários nos arquivos versionados; ferramentas ignoradas.
