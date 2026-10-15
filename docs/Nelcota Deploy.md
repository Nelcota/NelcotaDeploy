# Nelcota Deploy: plano do sistema

Oct 14, 2026 · @Haniel Braga Fialho Cota

## Visão geral

O Nelcota Deploy é um sistema de deploy open source, self-hosted, em duas VPS: uma roda o **painel** e outra roda as **apps**. Cada push na `main` entra numa fila e vira um deploy zero-downtime em segundos, controlado por completo pelo painel.

**Objetivos da v1**

- Push na `main` → app no ar em 10–60 s (com cache de dependências).
- Plataforma consumindo menos de 300 MB de RAM na VPS de deploy.
- Instalação com um comando por VPS, em menos de 5 minutos.
- Nenhuma porta de controle exposta na internet.

**Princípios**

- **Simples:** binários únicos, SQLite, nada de Redis ou Kubernetes.
- **Rápido:** cache de dependências, coalescing na fila, builds com prioridade baixa.
- **Seguro por padrão:** WireGuard + mTLS, lista fechada de ações, containers endurecidos.
- **Sem lixo no disco:** nenhuma build antiga guardada; só a imagem em execução e um cache de dependências com teto.
- **Moderno:** previews por PR, rollback automático por saúde e scale-to-zero na fase 2.

## Arquitetura

O painel guarda o **estado desejado** de cada app; o agent no server compara com o que está rodando e corrige a diferença. O agent abre a conexão para o painel (saída), sempre dentro de um túnel WireGuard, então o server não expõe nenhuma porta de controle.

&#91;embedded content: arquitetura · 2 VPS, 1 túnel\]

- **VPS Painel:** API + UI, fila de deploys, SQLite, recebe webhooks do GitHub, streaming de logs.
- **VPS Server:** agent, Docker + BuildKit, Caddy (SSL e roteamento), containers das apps.
- **Entre as duas:** WireGuard + mTLS, protocolo de comandos fechado.
- **Internet:** só 80/443 no server (via Caddy) e 443 no painel (ou painel só via WireGuard/Tailscale).

## Stack tecnológica

Go nos dois lados: binário único, pouca RAM, ótimas libs de Docker, Git e WebSocket.

| Camada | Escolha | Por quê | Alternativa |
| --- | --- | --- | --- |
| Backend do painel | Go (`net/http` ou Echo/Chi) | Binário único, \~30–50 MB de RAM | Bun + Hono |
| Agent | Go | \~10–25 MB de RAM, sem dependências | — |
| Banco | SQLite em modo WAL | Zero manutenção, backup = 1 arquivo | Postgres quando crescer |
| Fila | Tabela no SQLite + worker em Go | Sem Redis, transacional | River (se migrar para Postgres) |
| Frontend | templ + Datastar + Tailwind CSS v4 | HTML gerado no Go, menos de 100 KB de JS, SSE nativo para logs | htmx 2 + Alpine.js |
| Tempo real | SSE para logs, ConnectRPC (streaming) para o agent | Simples e nativo no browser | — |
| Proxy | Caddy com API admin | SSL automático, HTTP/3, troca de rota sem reload | Traefik |
| Build | Docker + BuildKit | Cache mounts, `--secret`, GC por tamanho | — |
| Detecção de stack | Railpack/Nixpacks + templates próprios | Dockerfile otimizado sem configuração | Dockerfile do repo |
| Rede privada | WireGuard | No kernel, overhead mínimo | Tailscale |
| Auth do painel | Passkeys (WebAuthn) + TOTP | Sem senha vazável | — |

## Bibliotecas

Prioridade para a biblioteca padrão do Go; libs externas só onde poupam muito trabalho, todas amplamente usadas e mantidas.

**Backend (painel e agent, Go)**

| Necessidade | Lib | Por quê |
| --- | --- | --- |
| Roteamento HTTP | `net/http` (padrão) + `go-chi/chi` v5 | Leve, compatível com o padrão, middlewares prontos |
| Templates HTML | `a-h/templ` | Templates tipados e compilados, muito rápidos |
| Protocolo painel ↔ agent | `connectrpc/connect-go` + `planetscale/vtprotobuf` | Streaming bidirecional tipado sobre HTTP/2; serialização sem reflection; a lista fechada de ações é garantida pelo compilador |
| SQLite | `ncruces/go-sqlite3` (sem cgo, compatível com sqlc) | Moderno e estático; `zombiezen.com/go/sqlite` só se o pprof mostrar overhead do `database/sql` |
| Queries | `sqlc-dev/sqlc` | Gera código Go tipado a partir do SQL, zero overhead de ORM |
| Migrações | `pressly/goose` | Simples, embutível no binário |
| Builds | `moby/buildkit` (cliente) | Fala direto com o BuildKit: cache, secrets e logs por etapa, sem o CLI do Docker |
| Containers e redes | Cliente oficial do Docker/Moby | API completa de containers, redes e imagens |
| GitHub | `google/go-github` + `bradleyfalzon/ghinstallation` | API do GitHub e tokens de GitHub App |
| Passkeys e 2FA | `go-webauthn/webauthn` + `pquerna/otp` | Padrão de fato em Go |
| Criptografia | `crypto/aes` + `crypto/cipher` (padrão), `golang.org/x/crypto` | AES-GCM sem dependência externa |
| WireGuard | `golang.zx2c4.com/wireguard/wgctrl` | Lib oficial do projeto WireGuard |
| Cache em memória | `maypok86/otter` | Um dos caches mais rápidos em Go, alta taxa de acerto (sessões, estado das apps) |
| Concorrência | `sourcegraph/conc` + `golang.org/x/sync/errgroup` | Goroutines com limite e captura de panic, sem boilerplate |
| Métricas do server | `shirou/gopsutil` | CPU, RAM, disco, rede em uma API |
| Métricas exportadas | `VictoriaMetrics/metrics` | Formato Prometheus, bem mais leve que o client oficial |
| Compressão de logs | `klauspost/compress` (zstd) | A implementação zstd mais rápida em Go |
| Hash rápido | `zeebo/xxh3` | Chaves de cache e dedupe de logs |
| JSON da API | `encoding/json` (padrão); `bytedance/sonic` se o pprof pedir | Sonic é um dos JSON mais rápidos em Go (amd64/arm64) |
| Logs | `log/slog` (padrão) | Estruturado, sem dependência |
| Rate limit | `golang.org/x/time/rate` | Login e webhooks |
| Validação | `go-playground/validator` | Validação de formulários e API |
| CLI | `spf13/cobra` | `nelcota restore`, `uninstall`, `update` |
| Config | `knadh/koanf` | Mais leve que Viper |
| Testes | `stretchr/testify` + `testcontainers-go` + `go.uber.org/goleak` | Integração com Docker real e detecção de goroutines vazando |

**Git:** usar o binário `git` em vez de `go-git`: o clone raso é bem mais rápido.

**Opção: Caddy embutido no agent.** O Caddy é escrito em Go e pode ser importado como lib: agent e proxy viram um único binário, sem chamadas à API admin. Contrapartida: atualizar o Caddy exige uma nova versão do agent.

**Regra geral:** biblioteca padrão primeiro; libs "rápidas" (Sonic, zombiezen) só onde o pprof provar o gargalo.

**Frontend**

| Necessidade | Lib | Por quê |
| --- | --- | --- |
| Templates | `a-h/templ` | Componentes tipados, compilados junto com o Go |
| Interatividade | Datastar | Atualizações guiadas por SSE com SDK oficial em Go; sem SPA |
| Estilo | Tailwind CSS v4 | Motor novo em Rust, build muito rápido, CSS final mínimo |
| Componentes | Basecoat | Visual do shadcn/ui sem React, só HTML e Tailwind |
| Ícones | Lucide | SVG leves, inseridos direto no HTML |
| Gráficos de métricas | `uPlot` | \~50 KB, aguenta milhares de pontos com fluidez |
| Logs ao vivo | `xterm.js` | Visual de terminal, cores ANSI, rolagem eficiente |

Tudo vai embutido no binário com `embed`, pré-comprimido e com cache `immutable`. Resultado: menos de 100 KB de JS no painel e um único binário para distribuir.

**Plano B:** se o Datastar não atender algum caso, htmx 2 + Alpine.js cobrem o mesmo modelo, com os mesmos templates.

**Build e release:** `goreleaser` para binários multi-arquitetura, `cosign` para assinatura, `golangci-lint` no CI.

## Performance máxima em Go

O ganho vem de três frentes: usar o Go mais novo (que já traz o GC Green Tea), compilar para a CPU certa com PGO, e não alocar nem bloquear nos caminhos quentes (logs, fila, SQLite). Tudo medido com pprof antes e depois.

**Compilação**

| Técnica | O que fazer | Ganho |
| --- | --- | --- |
| Go 1.26 ou mais novo | Fixar a versão no `go.mod` e no CI | GC Green Tea por padrão: 10–40% menos overhead de GC ([notas do Go 1.26](https://go.dev/doc/go1.26)) |
| PGO | Coletar perfil de CPU em produção, salvar como `default.pgo` em cada `main` | Inlining e devirtualização guiados por uso real |
| CPU-alvo | Publicar binários `GOAMD64=v1` e `v3`; o instalador escolhe conforme a CPU (AVX2) | Instruções vetoriais em VPS modernas |
| Binário enxuto | `-trimpath -ldflags="-s -w"` | Binário menor, download e start mais rápidos |
| Agent estático | `CGO_ENABLED=0` no agent | Roda em qualquer distro, sem libc |

```bash
GOAMD64=v3 CGO_ENABLED=0 go build -pgo=auto -trimpath -ldflags="-s -w" ./cmd/nelcota-agent
```

**Runtime**

- `GOMEMLIMIT` em \~80% do `MemoryMax` do serviço systemd: o GC aperta perto do limite em vez de levar OOM.
- `GOMAXPROCS` já respeita o limite de CPU do cgroup desde o Go 1.25: nada de `automaxprocs`.
- `GOGC` padrão; só ajustar se o pprof mostrar GC como gargalo.

**Código nos caminhos quentes**

- Logs de build: ring buffer por deploy + fan-out com channels bufferizados; consumidor lento é desconectado, nunca trava o build.
- `sync.Pool` para buffers de log e encoders zstd; reaproveitar `[]byte` em vez de alocar por linha.
- `bufio.Writer` em arquivos e sockets; `io.Copy` para streams (usa `splice`/`sendfile` quando possível).
- Tudo com `context.Context`: cancelar um deploy encerra clone, build e streams na hora.
- Concorrência limitada com `errgroup.SetLimit` (builds, pulls, healthchecks).
- Stream ConnectRPC do agent sem compressão (rede interna via WireGuard): economiza CPU.
- Protocolo em Protobuf com vtprotobuf: serialização sem reflection e com poucas alocações.

**SQLite**

- `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`.
- Uma conexão de escrita + pool de leitura (`SetMaxOpenConns`), evitando disputa de lock.
- Statements preparados (sqlc) e escritas em lote dentro de transações (eventos, métricas).
- `cache_size` e `mmap_size` ajustados ao tamanho do banco.

**HTTP e assets**

- Assets do painel com `embed`, pré-comprimidos (br/zstd) no build e servidos com nome com hash + `Cache-Control: immutable`.
- `http.Server` com `ReadHeaderTimeout`, `IdleTimeout` e keep-alive; HTTP/2 atrás do Caddy.

**Medição contínua**

- `net/http/pprof` exposto só na interface WireGuard.
- `runtime/trace` com flight recorder para capturar os últimos segundos quando um deploy ficar lento.
- Benchmarks com `b.Loop()` nos caminhos quentes e `benchstat` no CI para barrar regressões.

## Componentes

São quatro peças, cada uma com uma responsabilidade clara.

**Painel (`nelcota-panel`)**

- Recebe e valida webhooks do GitHub (HMAC `X-Hub-Signature-256`).
- Mantém o estado desejado de apps, servers e deploys no SQLite.
- Fila e scheduler: decide qual deploy roda em qual server, aplica coalescing.
- UI web e API REST com tokens de escopo limitado.
- Hub de conexões dos agents e repasse de logs ao browser via SSE.

**Agent (`nelcota-agent`)**

- Conecta no painel por ConnectRPC (stream bidirecional) sobre WireGuard + mTLS; reconecta sozinho.
- Executa apenas as ações da lista fechada (seção Protocolo).
- Loop de reconciliação a cada 10 s: estado real × estado desejado.
- Envia métricas (CPU, RAM, disco, rede) e eventos de container.

**Builder (dentro do agent)**

- Clone raso em pasta temporária, build com BuildKit num cgroup de baixa prioridade, apaga tudo no fim.

**Proxy (Caddy)**

- Termina TLS, roteia domínio → container, compressão zstd/gzip, HTTP/3.
- Configurado só pelo agent, via API admin em `localhost:2019`.

## Fluxo de deploy e fila

Um push vira produção em 9 etapas; se o healthcheck falhar, a versão antiga nunca sai do ar.

1. GitHub envia o webhook `push` para o painel.
2. Painel valida a assinatura HMAC e a branch configurada.
3. Cria um deploy `queued`; se já houver outro `queued` da mesma app, o antigo vira `cancelled` (coalescing).
4. Scheduler envia `deploy` ao agent quando a app não tem deploy rodando e o server tem vaga de build.
5. Agent gera token temporário do GitHub App e faz `git clone --depth 1` do SHA.
6. Build com BuildKit (cgroup de baixa prioridade), logs em streaming para o painel.
7. Sobe o container novo na rede da app e espera o healthcheck (timeout configurável, padrão 60 s).
8. Se passou: troca a rota no Caddy, drena e para o container antigo, apaga a imagem antiga. Se falhou: remove o container novo, mantém o antigo e marca `failed`.
9. Painel publica o status no commit (check run) e envia notificações.

**Regras da fila**

- Um deploy ativo por app.
- Máximo de builds simultâneos por server (padrão: 1 para até 4 GB de RAM, 2 acima).
- Coalescing: só o commit mais recente de cada app fica na fila.
- Botão de cancelar a qualquer momento; o agent mata o build e limpa a pasta.
- Prioridade manual: deploy disparado pelo painel ou rollback passa na frente dos automáticos.

**Estados:** `queued` → `building` → `starting` → `success` | `failed` | `cancelled`.

## Build, cache e armazenamento

Nenhuma build antiga é guardada: no disco fica só a imagem em execução e um cache de dependências com teto fixo.

| Item | Fica no disco? | Política |
| --- | --- | --- |
| Código-fonte | Não | Clone raso em `/tmp/build-<id>`, apagado ao fim do deploy (sucesso ou falha) |
| Imagem em execução | Sim, 1 por app | Necessária para o container existir |
| Imagens anteriores | Não | Apagadas logo após a troca de rota |
| Cache de dependências (BuildKit) | Sim, com teto | Padrão 5 GB por server, limpa o que não é usado há 7 dias; desligável por app |
| Logs de build | Sim, no painel | Últimos 50 deploys por app, comprimidos |

**Consequência:** rollback = novo build do SHA antigo (não instantâneo, mas sem custo de disco).

**Para o build ser rápido**

- Cache mounts para `node_modules`, `~/.cache/go-build`, pip, composer, cargo.
- Dockerfiles gerados com a ordem certa: lockfile → instalar dependências → copiar código.
- Build num cgroup com `cpu.weight` baixo e limite de RAM: apps em produção nunca ficam lentas.
- Imagens base pré-baixadas e atualizadas semanalmente por um job do agent.
- Segredos de build via `--secret`, nunca em `ARG` ou camada da imagem.

**No painel:** cache ligado/desligado e teto em GB, botão "Limpar cache" e opção "Build limpo" por deploy.

## Protocolo painel ↔ agent

O agent só entende uma lista fechada de ações tipadas; não existe "rodar comando arbitrário". Contrato em \`.proto\` transportado por ConnectRPC em stream bidirecional; cada mensagem tem `id`, `type` e assinatura do painel.

| Ação | Parâmetros | Observação |
| --- | --- | --- |
| `deploy` | app, SHA, config | Clone, build, start, healthcheck, troca de rota |
| `cancel` | deploy\_id | Mata o build e limpa a pasta |
| `rollback` | app, SHA | Dispara build do SHA anterior |
| `start` / `stop` / `restart` | app | — |
| `scale` | app, réplicas | Caddy faz balanceamento entre réplicas |
| `set_config` | app, env, limites, domínio | Aplica com restart controlado |
| `logs` | app, desde, follow | Stream de logs de runtime |
| `stats` | — | Métricas do server e por container |
| `prune` | escopo | Limpa cache ou imagens órfãs |
| `exec` (opcional) | app, comando | Exige 2FA de novo + registro em auditoria; desativado por padrão |

**Eventos do agent para o painel:** `deploy_log`, `deploy_status`, `container_event`, `metrics` (a cada 15 s), `heartbeat` (a cada 5 s).

**Reconciliação:** a cada 10 s e a cada reconexão, o agent pede o estado desejado e corrige divergências (container morto, rota faltando, config antiga).

## Segurança em camadas

Cada camada assume que a anterior pode falhar: roubar a sessão do painel não dá shell no server, e uma app comprometida não enxerga as outras.

| Camada | Medidas |
| --- | --- |
| Rede | WireGuard entre as VPS; agent escuta só na interface `wg0`; firewall libera apenas 22, 80, 443 e a porta do WireGuard; SSH só por chave |
| Docker × firewall | Apps nunca publicam portas (`-p`); só a rede do Caddy; regras extras na chain `DOCKER-USER` |
| Painel ↔ agent | mTLS com CA interna e certificado por server; mensagens assinadas; token de convite de uso único (15 min) |
| Ações | Lista fechada; `exec` desligado por padrão; ações destrutivas pedem confirmação |
| Containers | Usuário não-root, `no-new-privileges`, `cap-drop ALL`, rede Docker por app, limites de CPU/RAM, nunca montar `docker.sock` |
| Segredos | AES-256-GCM no banco, chave mestra em `/etc/nelcota/master.key` (600); injetados só em runtime; mascarados nos logs |
| Login | Passkeys + TOTP, rate limit, cookies `httpOnly`/`secure`/`sameSite=strict`, sessões curtas |
| GitHub | GitHub App com tokens de 1 h; HMAC validado em tempo constante |
| Auditoria | Log imutável de quem fez o quê: deploy, env, domínio, exec, login |
| Sistema | `unattended-upgrades`, CrowdSec ou fail2ban, serviços systemd com sandbox (`ProtectSystem=strict`, `NoNewPrivileges`) |
| Supply chain | Binários assinados (minisign/cosign) e checksum verificado na instalação e nas atualizações |

## Painel: telas e funcionalidades

Seis telas cobrem a v1; tudo que o agent sabe fazer tem um botão aqui.

| Tela | O que mostra | Ações |
| --- | --- | --- |
| Dashboard | Apps com status, último deploy, CPU/RAM de cada server | Deploy rápido, ir para logs |
| App › Deploys | Histórico com SHA, autor, duração por etapa, status | Deploy agora, cancelar, rollback, build limpo |
| App › Logs | Logs do build e de runtime ao vivo, com busca | Pausar, baixar |
| App › Configurações | Repo, branch, domínios, env vars, healthcheck, recursos, réplicas | Salvar e aplicar |
| Servers | Status online, métricas, uso de disco e cache | Adicionar server (gera convite), limpar cache |
| Ajustes | Usuários, passkeys, GitHub App, notificações, backup, auditoria | Atualizar plataforma |

**Detalhes de UX**

- Barra de comando ⌘K para navegar e disparar ações.
- Duração de cada etapa do deploy (fila, clone, build, start, healthcheck) e taxa de acerto do cache.
- Tema claro e escuro, responsivo para usar no celular.

## Modelo de dados

Oito tabelas no SQLite bastam para a v1.

| Tabela | Campos principais |
| --- | --- |
| `users` | id, email, nome, papel (admin/membro), criado\_em |
| `credentials` | user\_id, tipo (passkey/totp), dados públicos, último uso |
| `servers` | id, nome, ip\_wireguard, fingerprint do certificado, status, último heartbeat, limites de build |
| `apps` | id, nome, server\_id, repo, branch, build (auto/dockerfile), healthcheck, recursos, réplicas, cache ligado |
| `domains` | id, app\_id, host, https |
| `env_vars` | app\_id, chave, valor criptografado, disponível no build (sim/não) |
| `deployments` | id, app\_id, sha, mensagem, autor, origem (push/manual/rollback), status, tempos por etapa, log\_ref |
| `audit_log` | id, user\_id, ação, alvo, detalhes, ip, criado\_em |

A fila é a própria tabela `deployments` filtrada por `status = 'queued'`, com índice em `(app_id, status)`. Logs de build ficam em arquivos `zstd` fora do banco, referenciados por `log_ref`.

## Instalação, atualização e backup

Dois comandos instalam tudo; o resto se faz pelo painel.

**1. VPS do painel (1–3 min)**

```bash
curl -fsSL https://get.seudominio.com/install.sh | sudo bash -s -- panel --domain painel.seudominio.com
```

Verifica o sistema (Debian 12+/Ubuntu 22.04+), endurece o servidor, instala Caddy e WireGuard, baixa e verifica o binário, cria usuário de sistema e serviço systemd com sandbox, gera chave mestra, CA interna e chaves WireGuard, e mostra um link de primeiro acesso de uso único.

**2. Primeiro acesso**

Cria o admin com passkey, depois "Conectar GitHub" usando o GitHub App Manifest: um clique cria o App já configurado e o painel recebe as credenciais sozinho.

**3. VPS de deploy (2–5 min)**

```bash
curl -fsSL https://painel.seudominio.com/agent.sh | sudo bash -s -- --join <token>
```

Token gerado em "Adicionar servidor", válido por 15 min e uso único. Instala Docker + BuildKit (GC de cache, log rotation, `DOCKER-USER`), Caddy com API só em localhost, registra-se no painel, recebe config WireGuard e certificado mTLS, sobe o agent e o cgroup de builds.

**Operação**

- **Atualizar:** botão no painel; baixa, verifica assinatura, reinicia; agents atualizam um por vez.
- **Backup:** diário, `VACUUM INTO` do SQLite + chave mestra criptografada, enviado para S3 compatível (R2, Backblaze, MinIO). Restaurar = `nelcota restore <arquivo>`.
- **Desinstalar:** `nelcota uninstall` (mantém dados) ou `--purge`.
- **Alternativa ao `curl | bash`:** script para baixar e revisar antes, e pacote `.deb` assinado numa fase futura.

## Recursos modernos (fase 2)

Entram depois que o núcleo estiver estável e usam as mesmas ações e logs que a v1 já tem.

| Recurso | O que faz |
| --- | --- |
| Previews por PR | URL `pr-42.app.dominio.com` por PR, link comentado no PR, destruída ao fechar |
| Rollback automático por saúde | Observa 5xx e latência por 5 min após o deploy; volta sozinho se piorar |
| Scale-to-zero | Desliga apps ociosas e acorda no primeiro request (Caddy segura 1–2 s) |
| Notificações | Discord, Slack, Telegram, WhatsApp, e-mail |
| `nelcota.toml` opcional | Config como código no repo, refletida no painel |
| Varredura de vulnerabilidades | Trivy em segundo plano após o deploy; alerta se crítico |
| Detecção de segredo vazado | Bloqueia build se achar chave commitada |
| Backup para S3 | Litestream replicando o SQLite continuamente |

## Metas de performance

Metas para uma VPS de 2–4 vCPUs, 4–8 GB de RAM e NVMe; são estimativas a validar com medição real na fase 1.

| Métrica | Meta | Como medir |
| --- | --- | --- |
| RAM do painel em repouso | ≤ 60 MB | `systemd-cgtop` / métricas do painel |
| RAM do agent em repouso | ≤ 25 MB | idem |
| Webhook → deploy na fila | < 1 s | Timestamp do webhook × `queued_at` |
| Clone raso | < 5 s (repo médio) | Duração da etapa "clone" |
| Deploy Node com cache | 15–40 s | Duração total do deploy |
| Deploy Go com cache | 5–15 s | idem |
| Start + healthcheck + troca | 2–10 s | Etapas "start" e "healthcheck" |
| Requisições perdidas no deploy | 0 | Teste de carga com `oha` durante deploys |
| Overhead do proxy | < 1 ms por request | Comparação direta × via Caddy |
| Instalação completa | < 5 min por VPS | Cronômetro no script |

**Riscos para a velocidade:** disco lento, Dockerfile mal ordenado e builds pesados em VPS de 2 GB (usar swap e 1 build por vez). O painel mostra a duração de cada etapa e a taxa de acerto do cache para achar o gargalo.

## Roadmap

Duas fases em sequência; os recursos modernos só entram depois que o núcleo estiver estável em produção.

&#91;embedded content: roadmap · 2 fases, 1 gate\]

**Fase 1 · Núcleo: entregáveis em ordem**

- [ ] Agent em Go: conexão WebSocket + mTLS, heartbeat, reconexão.
- [ ] Deploy no agent: clone raso, build BuildKit, healthcheck, troca de rota no Caddy, limpeza.
- [ ] Painel: webhook com HMAC, tabela de deploys, worker da fila com coalescing.
- [ ] Logs ao vivo (agent → painel → browser via SSE).
- [ ] UI: dashboard, deploys, logs, configurações de app, servers.
- [ ] Segurança: passkeys, criptografia de env, auditoria, containers endurecidos.
- [ ] Instaladores `install.sh` e `agent.sh`, com WireGuard e token de convite.
- [ ] Medir as metas de performance e ajustar.

**Fase 2 · Moderno**

- [ ] Previews por PR, rollback automático, scale-to-zero, notificações, `deploy.toml`, Trivy, detecção de segredos, backup para S3.

## Riscos e decisões em aberto

**Riscos**

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Build enche a RAM da VPS | Apps caem por OOM | cgroup com limite de RAM para builds, swap, 1 build simultâneo em VPS pequena |
| Disco cheio | Deploys e apps param | Teto de cache, prune automático, alerta a 80% |
| Painel fora do ar | Sem novos deploys | Apps continuam rodando; agent mantém o último estado desejado |
| Chave mestra perdida | Env vars irrecuperáveis | Backup criptografado separado, aviso no primeiro acesso |
| Rollback lento (sem imagens guardadas) | Recuperação leva o tempo de um build | Opção futura: guardar 1 imagem anterior, desligada por padrão |
| Escopo crescer demais | Projeto nunca fica pronto | Seguir as fases; v1 só com o núcleo |

**Decisões em aberto**

- [ ] Domínio do projeto.
- [ ] Licença: MIT/Apache-2.0 (mais adoção) ou AGPL-3.0 (protege contra SaaS fechado).
- [x] Frontend: templ + Datastar + Tailwind CSS v4 (decidido).
- [ ] Suportar só Dockerfile na v1 ou já incluir detecção automática de stack.
- [ ] Multiusuário com papéis já na v1 ou só admin único.
- [ ] Painel acessível pela internet com passkey, ou só via WireGuard/Tailscale.
