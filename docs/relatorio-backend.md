# Relatório do backend — 2026-10-15

Foi entregue um backend funcional para desenvolvimento do frontend, com dois binários Go e sem implementação de templ/Datastar/Tailwind. Ainda não é uma versão homologada para produção. As pendências locais de operação foram concluídas; os gates de infraestrutura e credenciais estão em `pendencias.md` e os comandos em `operacao-backend.md`.

## Executar localmente

Requisitos: Go 1.26.9, make, protoc e shellcheck. `make tools` instala os geradores, sqlc, golangci-lint e benchstat.

```sh
make tools generate build test lint
make dev-seed
make dev
```

Acessar `http://127.0.0.1:8080`. A página é placeholder; APIs e SSE estão disponíveis. POST `/api/dev/session` com Origin `http://127.0.0.1:8080` e JSON `{}` emite a sessão de desenvolvimento. GET `/api/session` fornece o token CSRF para mutações. Há três apps, servers, deploys e logs de exemplo; o agent simulado emite eventos e aceita cancelamento. Dados ficam em `.local/dev`, ignorada pelo Git.

Os binários compilados nesta sessão estão em `bin/`; executar `./bin/nelcota-panel dev` dispensa recompilar. O Go usado nesta máquina foi preparado em `/tmp/nelcota-tools/go`; uma máquina nova deve instalar o toolchain ou usá-lo no PATH. `docs/contrato-frontend.md` documenta métodos, DTOs, permissões, autenticação, tokens, streams e exemplo completo de handler.

## Estado dos marcos

| Marco | Estado | Entrega e limite de aceitação |
|---|---|---|
| 1. Esqueleto | Completo | Monorepo, Go 1.26, build estático com PGO auto, Makefile, CI, geradores reproduzíveis, lint e goleak |
| 2. Protocolo | Completo em código | Protobuf/vtprotobuf, ConnectRPC bidirecional HTTP/2, CA, mTLS, assinatura, replay persistente, heartbeat, timeout e reconexão; testado em TLS real local |
| 3. Pipeline | Parcial na aceitação | Clientes oficiais BuildKit/Moby, Git por SHA exato, endurecimento, healthcheck, swap, journal cifrado e reconciliação implementados; testes com doubles e com Docker/BuildKit/Caddy reais passaram; cgroups de baixa prioridade, WireGuard e VPS ainda precisam de homologação |
| 4. Painel | Completo em código | SQLite WAL, escritor único, pool de leitura, goose/sqlc, serviços/DTOs, fila concorrente e coalescing, HMAC/deduplicação, GitHub App e check runs com outbox/retry; API GitHub coberta com transporte simulado |
| 5. Logs/eventos | Completo com limites | Ring de 1 MiB por deploy, transporte limitado, hub sem bloquear produtor, SSE, runtime logs, métricas de host/containers e retenção zstd; streams não prometem replay ou entrega sem perdas sob saturação/reconexão |
| 6. Segurança | Completo no núcleo | WebAuthn/TOTP, recovery codes e reset com autenticador virtual nos testes, cookies/CSRF/rate limit, AES-GCM/AAD, escopos, convites, auditoria e logs mascarados; browsers/dispositivos e infraestrutura reais pendentes |
| 7. Instaladores | Parcial na aceitação | Scripts, assinatura, checksums, systemd, WireGuard, firewall e hardening; shellcheck passou; sintaxe validada em containers Debian 12 e Ubuntu 22.04; instalação/reboot e publicação de releases ainda não executados |
| 8. Performance | Parcial | Benchmarks, script das dez metas, comparação no CI, tempos por etapa e diagnóstico privado implementados; memória investigada/corrigida localmente; demais metas e homologação de VPS permanecem abertas |

Checkboxes de progresso representam implementação local, não homologação. O plano existente era `docs/Nelcota Deploy.md`; `AGENTS.md` e `docs/plano.md` não estavam presentes. O repositório recebido não tinha metadados Git válidos: foi inicializado e o trabalho foi registrado em commits em português.

## Verificações executadas

- `make build`: passou para os dois executáveis com CGO desabilitado, trimpath, ldflags de redução e PGO auto.
- Cross-compilação Linux arm64 dos dois executáveis: passou.
- `make test`: passou, incluindo fila com oito claimers concorrentes, HMAC/delivery dedupe, permissões, criptografia, triggers de auditoria, escopos/revogação, convite único/expiração, WebAuthn ECDSA válido/origem adulterada, TOTP replay, cancelamento, saúde e recuperação de estado.
- `make lint`: passou: gofmt incluindo arquivos de integração, go vet com e sem a tag integration, golangci-lint v2.11.3 (zero issues) e shellcheck v0.11.0.
- `CGO_ENABLED=1 go test -race -count=1 -timeout=180s ./...`: passou. Goleak está integrado aos testes dos componentes concorrentes.
- `make check-generated`: passou; regenerar Protobuf/Connect/vtprotobuf e sqlc não alterou os arquivos versionados.
- Caddy v2.10.2 nativo, com checksum SHA-512 oficial confirmado: integração de criar/substituir/remover rota e conferir upstream passou.
- `CADDY_BIN=/tmp/nelcota-caddy/caddy make test-integration`: passou após o Docker ficar disponível durante a sessão. Testcontainers executou BuildKit v0.34.0, Docker e Caddy v2.10.2; verificou hardening real, tráfego pelo proxy para a bridge da app, candidato com healthcheck inválido preservando produção, swap sob requisições contínuas sem perdas nessa carga local e remoção do container/imagem antigos. Scripts também passaram por bash -n em Debian 12 e Ubuntu 22.04. Não houve skips para converter ausência em aprovação.
- Smoke HTTP do binário dev: login, leitura de apps, bloqueio CSRF, deploy até success, logs zstd, cancelamento até cancelled e SSE runtime passaram. Processos de teste encerrados ao fim.
- Govulncheck v1.9.0: após atualização, zero vulnerabilidades em símbolos chamados/pacotes importados; um aviso de módulo sobre OpenPGP não importado. O scanner também está no CI.

CI foi escrito, mas não executado no GitHub nesta sessão: não há remoto/PR configurado. Releases multi-arquitetura e assinatura foram preparados, não publicados.

## Benchmarks locais

Ryzen 7 9700X, Linux amd64, Go 1.26.9. Cada benchmark usa `b.Loop()`. Números são desta máquina, não uma VPS:

| Caminho | ns/op | B/op | allocs/op |
|---|---:|---:|---:|
| Hub publish sem assinantes | 52,49 | 8 | 1 |
| Ring append em regime estável | 11,27 | 0 | 0 |
| Gravação zstd | 1.454 | 299 | 5 |
| AES-GCM seal | 133,1 | 96 | 4 |
| Enqueue/coalescing/auditoria SQLite reais | 81.169 | 7.955 | 175 |

A otimização zstd foi feita após medir 29.070 ns/op e 644.586 B/op com um encoder novo por linha. Pool de encoder/buffer reduziu esse custo, com round-trip comprimido verificado. `scripts/compare-benchmarks.sh` usa benchstat e falha em regressão estatisticamente significativa superior a 20%; PRs futuros terão base comparável.

O perfil mostrou cerca de 100 MiB de alocações iniciais no compilador WASM do SQLite, mas somente 9,4 MiB de heap vivo. Liberar as páginas temporárias uma vez reduziu o RSS aquecido de 119,2 MiB para cerca de 50 MiB no mesmo cenário. O teste final com API de backup, lock e restore observou 46,7–53,5 MiB no painel com diagnóstico ativo. O agent real começou em 32 MiB; ajustes de startup/GC reduziram para 27,3 MiB e a configuração de THP dos serviços levou a 24,6–25,0 MiB após duas coletas reais de telemetria, sem diagnóstico. Esses valores são locais, não medição de VPS. Condições e comandos em `operacao-backend.md`.

## Operação adicionada

Backup diário/manual criptografado e S3, restore offline e cópias anteriores, atualização assinada com rollback de executável e fila durável, uninstall, recovery codes/reset de TOTP, rotação automática dos certificados, ajuste de limites/cache por API, telemetria por container, bases semanais e trace automático de deploy lento estão implementados. O update aguarda deploys ativos, confirmação do helper, versão nova e prontidão; o painel é o último. Cada operação tem testes locais e o contrato está em `contrato-frontend.md`.

Verificações adicionais: interoperabilidade com Minisign oficial, assinatura/hash adulterados e downgrade recusados, troca de arquivo/rollback, backup com WAL ativo, restore recusado durante execução, chave errada/corrupção/truncamento/traversal recusados, criação de novo backup após restore, recovery code consumido uma vez sob concorrência, renovação por mTLS real e métricas/bases com Docker/BuildKit reais. Um smoke HTTP/CLI completo passou e os processos temporários foram encerrados.

## Decisões relevantes

1. Dockerfile obrigatório na v1; auto detecção não foi implementada. Nenhuma IA foi adicionada.
2. Sem exec e sem shell no protocolo. Git é chamado por argumentos fixos, sem token no argv e sem hooks/config externos. Build secrets usam provider BuildKit; runtime env não entra como ARG.
3. Containers sempre não-root, cap-drop ALL, no-new-privileges, filesystem somente leitura, tmpfs limitado, CPU/RAM/PIDs e bridge por app; nenhuma publicação de porta de app.
4. mTLS e assinatura são complementares. Certificado vincula o server; replay journal sobrevive a restart. Estado desejado e intenção de swap são cifrados no agent.
5. Webhooks e queue são transacionais. GitHub lento fica na outbox, sem bloquear heartbeat. Env é patch por chave; frontend nunca precisa ler valores existentes.
6. URLs/chave pública de distribuição não foram inventadas. Instaladores exigem release HTTPS e chave minisign confiável, recusam checksum sem assinatura e preservam instalações existentes por recusa explícita.
7. Dependências antigas foram substituídas após análise, incluindo BuildKit v0.34.0 e o cliente oficial Moby separado v0.6.2. As versões exatas ficam em go.mod/go.sum.

## Aceitação externa e fase 2

Manual antes de VPS: escolher licença/domínio/repositório oficial; publicar release assinado incluindo BuildKit auditado; configurar DNS e GitHub App; executar o guia em duas VPS descartáveis e conferir firewall, SSH, isolamento, cgroups e reboot; validar passkeys reais e carga durante swap.

As funcionalidades operacionais antes inventariadas como não implementadas foram concluídas. Permanecem as aceitações externas e a fase 2, listadas em `pendencias.md`. O update automático preserva o banco e reverte o executável; releases precisam manter compatibilidade de schema/protocolo para suportar essa volta. Docker, BuildKit e Caddy têm atualização própria. Uninstall conserva serviços compartilhados e containers para migração explícita.

## Pontos para revisão de segurança

- Homologar os instaladores antes de executá-los em uma máquina com dados: mudam firewall, SSH, Docker, systemd e chaves. A chave SSH prévia é exigida, mas o acesso real precisa estar testado pelo operador.
- O agent tem acesso ao socket Docker e, portanto, autoridade equivalente ao daemon; o sandbox e o protocolo fechado limitam o código exposto, mas isso não cria isolamento contra comprometimento completo do host.
- Apenas root pode distribuir/guardar chaves de release/CA/master e os arquivos de primeiro acesso. A perda da master key impede recuperar env/settings/TOTP cifrados. Backup automático criptografado foi implementado; guardar a chave independente fora do host/bucket é necessário para recuperar o arquivo.
- Auditoria é append-only por regras SQLite, não contra root editando o arquivo. Escopos são globais por domínio, sem ACL por app/equipe; users:write é altamente privilegiado.
- Validar drain de cinco segundos com requests longos/streaming e falhas/crashes durante o commit da rota antes de declarar zero downtime. O teste local de carga não representa todas as cargas/requests de uma VPS de produção.
- Logs ao browser são efêmeros, e saturação do transporte pode descartar logs. Não tratar o arquivo comprimido como trilha de entrega infalível.
- Diagnósticos ficam fora da API pública e só iniciam num endereço da interface configurada; perfis devem ser tratados como dados internos. Não foi produzido perfil PGO artificial.

## Fechamento das verificações desta continuação

Em 2026-10-15: build estático dos dois executáveis e cross-build Linux arm64, testes unitários, vet/lint/shellcheck, race, geração reproduzível e integração completa passaram. A integração inclui a assinatura produzida pelo Minisign oficial, métricas e prewarm reais, agent executável com telemetria por mTLS, BuildKit/Docker/Caddy e sintaxe Debian/Ubuntu. O smoke final repetiu o ciclo API → backup → recusa de restore online → restore offline → novo backup. Processos de teste foram encerrados. Govulncheck confirmou zero achados em símbolos chamados e pacotes importados, mantendo somente o aviso de módulo não importado já descrito.
