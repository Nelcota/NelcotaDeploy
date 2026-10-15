# Progresso do backend

Fonte: `docs/Nelcota Deploy.md`, lido integralmente em 2026-10-15. `AGENTS.md` e `docs/plano.md` não existem no checkout recebido.

- [x] 1. Esqueleto, toolchain Go 1.26, Makefile e CI
- [x] 2. Protocolo tipado, ConnectRPC, mTLS, assinatura, heartbeat e reconexão
- [x] 3. Pipeline do agent e reconciliação
- [ ] 4. SQLite, serviços, GitHub e fila
- [ ] 5. Logs, eventos e persistência zstd
- [ ] 6. Autenticação e segurança do servidor
- [ ] 7. Instaladores e guia de VPS
- [ ] 8. Benchmarks, medição e relatório

## Ambiente inicial

Diretório contém apenas o plano. Não há Go, Docker, shellcheck ou golangci-lint no PATH. `.git` é um diretório vazio somente leitura. Ferramentas serão preparadas em `/tmp`; limitações serão documentadas sem substituir testes reais por resultados simulados.

## Marco 1
Go 1.26.9 oficial verificado. Build estático, testes com goleak e lint (vet, golangci-lint, shellcheck) passaram. CI inclui race, geração reproduzível e integração. Docker ausente: integração externa registrada. Autorrevisão: sem segredos ou binários nos arquivos versionados; ferramentas ignoradas.

## Marcos 2 e 3
ConnectRPC/vtprotobuf com HTTP/2 e mTLS testado em servidor TLS real local; assinatura Ed25519, validade, identidade e replay cobertos. Correção do encerramento bidirecional confirmada com goleak. Pipeline via clientes oficiais BuildKit/Docker e Caddy, clone do SHA exato, contexto temporário, endurecimento, rollback por falha de saúde e cancelamento testados com doubles. Integração Docker externa ainda pendente. Autorrevisão: sem shell no protocolo; sem portas publicadas; credenciais Git fora de argv; estado do agent cifrado; troca de rota é ponto de commit.
