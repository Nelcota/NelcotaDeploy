# Nelcota Deploy

Plataforma interna para gerenciar aplicações e deploys em uma VPS Linux com Docker — no estilo
de Railway, Coolify e Dokploy, mas pensada para uma única organização.

Cadastre um repositório GitHub, escolha a branch e o Dockerfile, configure variáveis e domínios
e clique em **Deploy**. O worker clona o commit exato, constrói a imagem com BuildKit, sobe o
contêiner, verifica a saúde e só então troca a versão anterior. Logs aparecem ao vivo no painel.

## Sumário

- [Arquitetura](#arquitetura)
- [Requisitos](#requisitos)
- [Instalação e desenvolvimento local](#instalação-e-desenvolvimento-local)
- [Banco de dados](#banco-de-dados)
- [Worker e Docker](#worker-e-docker)
- [Primeiro administrador](#primeiro-administrador)
- [Cadastrar uma aplicação e fazer deploy](#cadastrar-uma-aplicação-e-fazer-deploy)
- [Webhook do GitHub (deploy automático)](#webhook-do-github-deploy-automático)
- [Domínios e HTTPS](#domínios-e-https)
- [Tasks agendadas](#tasks-agendadas)
- [MCP (Claude Code e outros clientes)](#mcp-claude-code-e-outros-clientes)
- [Produção com Docker Compose](#produção-com-docker-compose)
- [Testes e verificação](#testes-e-verificação)
- [Backup e restauração do SQLite](#backup-e-restauração-do-sqlite)
- [Problemas comuns](#problemas-comuns)
- [Limitações conhecidas](#limitações-conhecidas)

## Arquitetura

Monólito modular com **dois processos** que compartilham a camada de domínio e o SQLite:

```
             navegador ──HTTPS──► Traefik ──► web (TanStack Start)
                                     │          │  server functions, SSE, webhook, auth
                                     │          ▼
                                     │       SQLite (WAL)  ◄── fila de jobs persistida
                                     │          ▲
                                     ▼          │
                       contêineres das apps ◄── worker (Bun) ── docker CLI / git
```

| Processo         | Responsabilidade                                                                                                                                    | Acesso ao Docker        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `web`            | Painel, autenticação (Better Auth), server functions, endpoints HTTP, streaming de logs (SSE), webhook GitHub                                       | **Nenhum**              |
| `worker`         | Consome a fila: clone, build, start, health check, ações de contêiner, tasks, limpeza; coleta métricas e logs de runtime; agenda tasks (`Bun.cron`) | Socket do Docker        |
| `mcp` (opcional) | Servidor MCP via stdio para agentes                                                                                                                 | Nenhum (enfileira jobs) |

Operações demoradas nunca rodam na requisição HTTP: o web grava um job no SQLite e o worker o executa.
Logs de build e runtime são gravados no banco e enviados ao navegador por SSE, com retomada pelo
`Last-Event-ID` — não há broker de mensagens.

### Organização do código

```
src/
  config/        variáveis de ambiente validadas (Zod), geração do .env
  db/            schema Drizzle, conexão bun:sqlite (WAL), migrations
  shared/        código seguro para o navegador: schemas Zod, papéis, formatação pt-BR, parser de comandos
  auth/          Better Auth, sessões, usuários, tokens de API, bootstrap do admin
  audit/         trilha de auditoria
  projects/      projetos e aprovação
  environments/  variáveis de ambiente e secrets (AES-256-GCM)
  domains/       domínios (manuais e automáticos)
  deployments/   ciclo de vida, rollback, ações de contêiner
  jobs/          fila persistida com claim atômico e recuperação
  logs/          logs de deploy e de runtime, retenção
  tasks/         tasks, cron, execuções
  monitoring/    métricas do host e dos contêineres, saúde
  webhooks/      webhook do GitHub
  docker/        adaptador da docker CLI (argumentos estruturados, labels)
  git/           clone/checkout com GIT_ASKPASS
  process/       Bun.spawn com timeout, cancelamento e ambiente mínimo
  secrets/       SecretBox (AES-256-GCM) e redação de logs
  worker/        engine de deploy, runners, observador de contêineres, loop do worker
  mcp/           servidor MCP (stdio)
  web/           app TanStack Start: rotas, componentes, server functions, servidor de produção
fixtures/        app de exemplo usada no teste de integração com Docker real
drizzle/         migrations versionadas
```

## Requisitos

- Linux com **Bun 1.4+**, **git** e **Docker Engine** (com BuildKit; Docker 23+).
- Para HTTPS: um domínio com DNS apontando para a VPS e as portas 80/443 livres.

## Instalação e desenvolvimento local

```bash
bun install
bun run setup          # cria .env com BETTER_AUTH_SECRET, NELCOTA_ENCRYPTION_KEY e GITHUB_WEBHOOK_SECRET gerados
bun run admin:create --email voce@empresa.com --name "Seu Nome"
bun run dev            # aplica migrations e sobe o painel em http://localhost:3000
bun run worker         # em outro terminal: processa deploys, tasks e métricas
```

`bun run setup` nunca sobrescreve um `.env` existente. Variáveis disponíveis estão documentadas
em [`.env.example`](../.env.example).

| Variável                          | Obrigatória            | Para quê                                                                                   |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`              | sim (web)              | assina sessões (≥ 32 caracteres)                                                           |
| `NELCOTA_ENCRYPTION_KEY`          | sim (web e worker)     | 32 bytes em base64; criptografa secrets e tokens de repositório. **Não perca esta chave.** |
| `PUBLIC_URL`                      | sim                    | URL pública do painel (cookies, CSRF, URL do webhook)                                      |
| `GITHUB_WEBHOOK_SECRET`           | para deploy automático | segredo HMAC do webhook                                                                    |
| `DATABASE_PATH` / `WORKSPACE_DIR` | não                    | banco e diretório temporário de builds                                                     |
| `TRAEFIK_ENABLED`                 | não                    | adiciona labels de roteamento aos contêineres                                              |
| `NELCOTA_MCP_TOKEN`               | só no processo MCP     | token de API com escopo                                                                    |

## Banco de dados

SQLite via `bun:sqlite` em modo WAL, com Drizzle ORM e migrations versionadas em `drizzle/`.

```bash
bun run db:generate   # gera uma nova migration a partir de src/db/schema.ts
bun run db:migrate    # aplica migrations pendentes (o `dev` e o contêiner web já fazem isso)
```

Datas são gravadas em UTC (ISO 8601). Operações críticas (fila, deploys, variáveis, auditoria) usam
transações. Um índice único parcial garante no próprio banco que um projeto nunca tenha dois jobs
em execução ao mesmo tempo.

## Worker e Docker

```bash
bun run worker
```

O worker precisa de acesso ao Docker (usuário no grupo `docker` ou o socket montado no contêiner).
**Acesso ao socket do Docker equivale a root no host** — por isso só o worker o recebe; o processo
web nunca tem acesso a ele.

Garantias da engine:

- Todo comando é executado com `Bun.spawn` e vetor de argumentos — nunca via shell — e com ambiente
  mínimo (as chaves da plataforma não vazam para `git`/`docker`).
- Valores de variáveis e build args chegam ao Docker pelo ambiente do processo (`--env NOME`,
  `--build-arg NOME`), nunca pela linha de comando.
- Contêineres, imagens e a rede recebem as labels `io.nelcota.*`. Antes de iniciar, parar ou remover
  qualquer coisa, o worker confirma a label: **contêineres que não pertencem à plataforma nunca são tocados**.
- Nomes e tags determinísticos: imagem `nelcota/<slug>:<id curto do deploy>`, contêiner
  `nelcota-<slug>-<id curto>`.
- Recuperação: jobs têm lease renovado a cada 10 s. Se o worker morrer, o job volta para a fila
  (deploys têm uma nova tentativa) ou falha com mensagem clara; tasks interrompidas são marcadas como falhas.

### Troca de versão (downtime)

O contêiner novo sobe ao lado do antigo; só depois do health check passar o antigo é removido.
Se o novo falhar, ele é removido e o antigo continua no ar. Durante a troca os dois podem receber
tráfego por alguns segundos. **Não há promessa de zero downtime**: apps com estado local, migrations
incompatíveis ou portas fixas podem ter uma pequena indisponibilidade.

### Health check

1. O contêiner precisa estar `running` e não reiniciar durante a verificação.
2. Se a imagem define `HEALTHCHECK`, o veredito do Docker vale.
3. Senão, com "caminho de health check" configurado, faz `GET http://<ip>:<porta><caminho>` (2xx/3xx);
   sem caminho, uma conexão TCP na porta interna basta.
4. Precisa ficar saudável por 3 s seguidos dentro de `HEALTH_CHECK_TIMEOUT_SECONDS`.

## Primeiro administrador

Não existe cadastro público nem usuário padrão. Crie o primeiro admin localmente:

```bash
bun run admin:create --email voce@empresa.com --name "Seu Nome"
# senha gerada e exibida uma única vez; ou defina NELCOTA_ADMIN_PASSWORD=... antes do comando
```

O comando recusa criar outro admin se já existir um (use `--allow-additional`). Os demais usuários
são criados pelo admin em **Configurações → Usuários**, com os papéis:

| Papel         | Pode                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------ |
| Administrador | tudo: usuários, tokens, aprovação de projetos, configurações, auditoria                    |
| Desenvolvedor | criar/editar projetos, deploy, rollback, controlar contêineres, variáveis, domínios, tasks |
| Leitor        | somente leitura                                                                            |

Toda server function e endpoint verifica sessão e permissão no backend; a interface apenas esconde
o que o papel não permite.

## Cadastrar uma aplicação e fazer deploy

1. **Projetos → Novo projeto**: nome (o identificador é sugerido automaticamente), URL HTTPS do
   repositório GitHub, branch e porta interna. Dockerfile, contexto e health check ficam em _Avançado_.
2. **Variáveis**: crie configurações (visíveis) ou secrets (criptografados, nunca exibidos de volta).
   Marque "Disponível no build" para passar como build arg.
3. Clique em **Deploy** e acompanhe os logs ao vivo. O histórico fica em **Deploys**, com commit,
   autor, duração, status e **Rollback** para imagens anteriores ainda disponíveis.
4. **Redeploy** recria o contêiner a partir da imagem atual aplicando variáveis e domínios novos,
   sem rebuild. **Iniciar/Parar/Reiniciar** atuam no contêiner atual.

Segurança de código desconhecido: construir um repositório executa o Dockerfile dele. Projetos
criados por desenvolvedores começam **aguardando aprovação** e só fazem deploy depois que um admin
aprova; trocar o repositório de um projeto aprovado (por um não-admin) exige nova aprovação.

Repositórios privados: um admin pode salvar um token de leitura do GitHub em **Configurações do
projeto**. Ele é criptografado em repouso e entregue ao git apenas por `GIT_ASKPASS` — nunca em URL,
argumento de processo ou log.

## Webhook do GitHub (deploy automático)

1. Defina `GITHUB_WEBHOOK_SECRET` (o `bun run setup` já gera um).
2. No repositório: _Settings → Webhooks → Add webhook_
   - Payload URL: `<PUBLIC_URL>/api/webhooks/github` (também exibida em **Configurações → Servidor**)
   - Content type: `application/json`
   - Secret: o valor de `GITHUB_WEBHOOK_SECRET`
   - Eventos: _Just the push event_
3. Ative "Deploy automático" no projeto.

O endpoint valida a assinatura HMAC SHA-256 sobre o corpo bruto (limite de 1 MB), registra cada
entrega pelo `X-GitHub-Delivery` (reentregas são ignoradas), confere repositório e branch e enfileira
o deploy do **commit exato** do push. Entregas recebidas aparecem em **Configurações → Auditoria**.
O deploy manual funciona independentemente do webhook.

## Domínios e HTTPS

- Domínios por projeto em **Domínios**. Com um _domínio base_ em **Configurações → Organização**
  (ex.: `apps.empresa.com`), cada projeto ganha automaticamente `<slug>.apps.empresa.com`.
- Com `TRAEFIK_ENABLED=true`, o worker adiciona labels Traefik ao contêiner: um router por domínio,
  redirecionamento HTTP→HTTPS e certificado Let's Encrypt (`certresolver`). Mudanças de domínio
  valem no próximo deploy ou redeploy.
- O Traefik só roteia contêineres com `io.nelcota.managed=true` (ou o próprio painel) — veja a
  constraint em `docker-compose.yml`.

Para testar HTTPS: aponte um registro DNS `A` para a VPS, defina `ACME_EMAIL`, suba o Compose e
acesse o domínio. Sem DNS público (desenvolvimento), deixe `TRAEFIK_ENABLED=false`; o health check
e os logs funcionam normalmente, só não há roteamento externo.

## Tasks agendadas

Em **Tasks** cadastre comandos como `bun run db:migrate`. O texto é convertido em um vetor de
argumentos (aspas são respeitadas; `|`, `;`, `$()` são texto comum) e executado **dentro do contêiner
atual do projeto** via `docker exec` — nunca no host. A agenda usa cron de 5 campos
(`SCHEDULE_TIME_ZONE`, padrão `America/Sao_Paulo`); cada horário vira uma execução única
(`task + horário`), então reinícios do worker não duplicam execuções. Saída, código de saída e
duração ficam no histórico. Só administradores e desenvolvedores criam e executam tasks.

## MCP (Claude Code e outros clientes)

Servidor MCP com o SDK oficial (`@modelcontextprotocol/server` v2), via **stdio**, em processo separado.

Ferramentas: `list_projects`, `get_project`, `list_deployments`, `get_deployment`,
`get_deployment_logs`, `get_project_metrics`, `get_container_status` (escopo `read`) e
`deploy_project`, `restart_project` (escopo `deploy`). Não existe ferramenta para rodar comandos no host.

1. Em **Configurações → Tokens de API**, crie um token com os escopos desejados (exibido uma vez).
2. Configure o Claude Code na máquina da plataforma (o MCP lê o mesmo SQLite):

```bash
claude mcp add nelcota \
  --env NELCOTA_MCP_TOKEN=nct_... \
  --env DATABASE_PATH=/caminho/para/data/nelcota.db \
  -- bun run /caminho/para/NelcotaDeploy/src/mcp/main.ts
```

Ou em `.mcp.json`:

```json
{
  "mcpServers": {
    "nelcota": {
      "command": "bun",
      "args": ["run", "/caminho/para/NelcotaDeploy/src/mcp/main.ts"],
      "env": { "NELCOTA_MCP_TOKEN": "nct_...", "DATABASE_PATH": "/caminho/para/data/nelcota.db" }
    }
  }
}
```

O token é verificado ao iniciar e **a cada chamada** (revogação vale na hora); ações ficam na
auditoria como `token:<nome>`. Transporte HTTP não foi implementado: o servidor MCP nunca escuta na rede.

## Produção com Docker Compose

```bash
bun run setup                 # gere o .env e ajuste PUBLIC_URL, PANEL_DOMAIN, ACME_EMAIL
echo "DOCKER_GID=$(stat -c %g /var/run/docker.sock)" >> .env
docker compose build
docker compose up -d
docker compose exec web bun run admin:create --email voce@empresa.com
```

O Compose sobe **Traefik** (80/443, Let's Encrypt, socket somente leitura), **web** (sem socket,
roda migrations ao iniciar, health check em `/api/health`) e **worker** (único com o socket do
Docker, `stop_grace_period` de 2 min para terminar jobs). Dados persistem no volume `data`
(SQLite e workspaces) e certificados no volume `letsencrypt`. A rede `nelcota` é compartilhada
pelo proxy, pelo worker (para os health checks) e pelas aplicações.

Sem Compose: `bun run build`, depois `bun run db:migrate && bun run start` e `bun run worker`
(por exemplo como serviços systemd).

## Testes e verificação

```bash
bun run check        # formatação, oxlint, TypeScript, knip e testes
bun test             # testes unitários e de integração (SQLite em memória, Docker simulado)
bun run test:docker  # ciclo completo com Docker real: build, health check, start/stop/restart,
                     # rollback, task e limpeza usando fixtures/hello-app (python:3.13-alpine)
bun run build        # build de produção
```

O teste com Docker real só roda com `DOCKER_INTEGRATION=1` (é o que `test:docker` faz) porque
constrói imagens e cria contêineres; ele remove tudo o que criou ao final.

## Backup e restauração do SQLite

O banco está em WAL, então copie com a API de backup do SQLite em vez de copiar o arquivo:

```bash
# backup a quente (pode rodar com a plataforma no ar)
sqlite3 data/nelcota.db ".backup 'backup-$(date +%F).db'"
# no Compose:
docker compose exec web bun -e 'import {Database} from "bun:sqlite"; new Database("/data/nelcota.db").run("VACUUM INTO ?", ["/data/backup.db"])'
docker compose cp web:/data/backup.db ./backup.db

# restauração: pare web e worker, substitua o arquivo, remova -wal/-shm antigos e suba de novo
docker compose stop web worker
docker compose cp ./backup.db web:/data/nelcota.db
docker compose up -d
```

Guarde também o `NELCOTA_ENCRYPTION_KEY`: sem ele, secrets e tokens do backup são irrecuperáveis.

## Problemas comuns

| Sintoma                                     | Causa provável                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| "Worker ou Docker indisponível" no painel   | worker parado, sem permissão no socket (`DOCKER_GID`) ou daemon fora do ar                                         |
| Deploy fica "Na fila"                       | worker parado, ou outro job do mesmo projeto ainda em execução                                                     |
| "precisa ser aprovado por um administrador" | projeto criado por desenvolvedor; um admin deve aprovar                                                            |
| Health check falha                          | porta interna errada, app escutando em `127.0.0.1` em vez de `0.0.0.0`, ou caminho de health check retornando erro |
| Certificado não emitido                     | DNS ainda não aponta para a VPS, porta 80 bloqueada ou `ACME_EMAIL` ausente                                        |
| Webhook retorna 401                         | `GITHUB_WEBHOOK_SECRET` diferente do configurado no GitHub                                                         |
| Webhook retorna 503                         | `GITHUB_WEBHOOK_SECRET` não definido                                                                               |
| "configuração incompleta"                   | falta `NELCOTA_ENCRYPTION_KEY` ou `BETTER_AUTH_SECRET`                                                             |

## Limitações conhecidas

- Um único servidor (`server_id = "local"`); o domínio já reserva espaço para múltiplos servidores.
- Somente repositórios GitHub via HTTPS; privados exigem token de leitura (deploy keys SSH não implementadas).
- Um ambiente (`production`) por projeto; a tabela `environments` já existe para mais ambientes.
- Sem zero downtime garantido (veja [Troca de versão](#troca-de-versão-downtime)); sem portas publicadas
  no host — o tráfego entra pelo Traefik.
- Logs de runtime são coletados enquanto o worker está ativo; linhas emitidas com o worker parado são
  recuperadas pelo `docker logs --since` ao voltar, dentro do que o Docker ainda guarda.
- MCP apenas via stdio, na mesma máquina do banco.
- Não há terminal interativo nem limites de CPU/memória por contêiner configuráveis pela interface.
