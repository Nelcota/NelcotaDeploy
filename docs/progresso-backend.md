# Progresso do backend

Fonte: `docs/Nelcota Deploy.md`, lido integralmente em 2026-10-15. `AGENTS.md` e `docs/plano.md` não existem no checkout recebido.

- [x] 1. Esqueleto, toolchain Go 1.26, Makefile e CI
- [x] 2. Protocolo tipado, ConnectRPC, mTLS, assinatura, heartbeat e reconexão
- [x] 3. Pipeline do agent e reconciliação
- [x] 4. SQLite, serviços, GitHub e fila
- [x] 5. Logs, eventos e persistência zstd
- [x] 6. Autenticação e segurança do servidor
- [x] 7. Instaladores e guia de VPS
- [x] 8. Benchmarks, medição e relatório

## Ambiente inicial

Diretório contém apenas o plano. Não há Go, Docker, shellcheck ou golangci-lint no PATH. `.git` é um diretório vazio somente leitura. Ferramentas serão preparadas em `/tmp`; limitações serão documentadas sem substituir testes reais por resultados simulados.

## Marco 1
Go 1.26.9 oficial verificado. Build estático, testes com goleak e lint (vet, golangci-lint, shellcheck) passaram. CI inclui race, geração reproduzível e integração. Docker ausente: integração externa registrada. Autorrevisão: sem segredos ou binários nos arquivos versionados; ferramentas ignoradas.

## Marcos 2 e 3
ConnectRPC/vtprotobuf com HTTP/2 e mTLS testado em servidor TLS real local; assinatura Ed25519, validade, identidade e replay cobertos. Correção do encerramento bidirecional confirmada com goleak. Pipeline via clientes oficiais BuildKit/Docker e Caddy, clone do SHA exato, contexto temporário, endurecimento, rollback por falha de saúde e cancelamento testados com doubles. Integração Docker externa ainda pendente. Autorrevisão: sem shell no protocolo; sem portas publicadas; credenciais Git fora de argv; estado do agent cifrado; troca de rota é ponto de commit.

## Marcos 4, 5 e 6
SQLite real com WAL, escritor único, pool de leitura, goose e sqlc. Testes concorrentes de fila/coalescing, HMAC e deduplicação passaram. GitHub App Manifest, tokens e check runs implementados; credenciais reais continuam externas.

Hub limitado desconecta consumidor lento; ring por deploy; SSE e zstd com retenção de 50 deploys. Registro/login WebAuthn completos testados com autenticador virtual ECDSA e rejeição de origem adulterada. TOTP tem proteção contra repetição; convites de servidor são consumidos transacionalmente e têm teste de expiração/uso único. Testes HTTP verificam cookies e CSRF. Estado cifrado e journal de replay persistido no agent.

Autorrevisão: DTOs próprios, autorização nos serviços, handlers sem regras de negócio; segredos cifrados com AAD por app/chave; logs mascaram segredos fragmentados; triggers impedem UPDATE/DELETE da auditoria; diagnóstico somente em endereço da interface WireGuard. Integração real foi tentada e bloqueada pela ausência do daemon Docker, registrada em pendências.

## Marcos 7 e 8 — implementação entregue, aceitação parcial

Instaladores completos em shell, serviços systemd, firewall próprio, WireGuard, enrollment e validação minisign/SHA-256. Shellcheck passou. Não foi possível executar como root em Debian/Ubuntu; é um gate de aceitação aberto. Documentado em `testar-em-vps.md`.

Benchmarks b.Loop, comparação benchstat no CI, script de medição das dez metas, pprof/flight recorder na interface privada e tempos por etapa implementados. Pool zstd adotado após benchmark. As metas de produção não foram declaradas cumpridas; dados ausentes aparecem pending.

Validações adicionais: Caddy nativo v2.10.2 (checksum SHA-512 oficial confirmado) testado de fato: criar/substituir/remover rota e conferir upstream. Race detector passou. Dependências atualizadas após govulncheck; nova análise sem vulnerabilidades alcançáveis. Tokens de API com escopos, expiração e revogação testados; autorização fica nos serviços. O contrato do frontend cobre também esses métodos.

Os checkmarks acima indicam fonte implementada e verificada localmente. Estado de aceitação de cada marco, inclusive os parciais, está no relatório final; as pendências externas e extensões operacionais não implementadas permanecem abertas.

## Atualização final: gate Docker resolvido

Docker tornou-se disponível durante a sessão. A suíte integration completa passou com recursos reais: BuildKit, imagem endurecida, bridges, Caddy, tráfego durante swap, healthcheck inválido mantendo produção e remoção de container/imagem antigos. Sintaxe dos instaladores passou em containers Debian 12 e Ubuntu 22.04. Nenhum teste foi desativado. Continuam pendentes VPS/WireGuard/firewall/systemd reais e metas de produção. Revisão final também preserva o IP do cliente na auditoria de login.

Memória: o smoke final observou 125,3 MiB após uso, superior à medição inicial de repouso de 42,8 MiB. A meta de memória após aquecimento não está demonstrada; investigar com perfil. Esse resultado está exposto no relatório, sem substituir dados por estimativas.
