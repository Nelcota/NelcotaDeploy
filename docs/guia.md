# Nelcota Deploy

Plataforma interna para gerenciar aplicações e deploys em uma ou mais VPSs Linux com Docker — no estilo
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
- [Vários servidores](#vários-servidores)
- [Primeiro administrador](#primeiro-administrador)
- [Cadastrar uma aplicação e fazer deploy](#cadastrar-uma-aplicação-e-fazer-deploy)
- [GitHub (deploy automático e repositórios privados)](#github-deploy-automático-e-repositórios-privados)
- [Domínios e HTTPS](#domínios-e-https)
- [Alertas](#alertas)
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
| `worker`         | Consome a fila: clone, build, start, health check, ações de contêiner, tasks, limpeza; coleta métricas e logs de runtime; agenda tasks (`Bun.cron`) | Socket local e SSH      |
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
  docker/        adaptador da docker CLI (argumentos estruturados, labels, proxy dos servidores)
  git/           clone/checkout com credential helper (token só no ambiente)
  process/       Bun.spawn com timeout, cancelamento e ambiente mínimo; interface CommandRunner
  remote/        conexão SSH persistente (ssh2), execução remota e geração da chave do painel
  servers/       servidores, escolha automática, chave do painel e comando de instalação
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
bun run dev            # aplica migrations e sobe o painel em http://localhost:3000 (crie o admin nele)
bun run worker         # em outro terminal: processa deploys, tasks e métricas
```

`bun run setup` nunca sobrescreve um `.env` existente. Variáveis disponíveis estão documentadas
em [`.env.example`](../.env.example).

| Variável                          | Obrigatória        | Para quê                                                                                   |
| --------------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`              | sim (web)          | assina sessões (≥ 32 caracteres)                                                           |
| `NELCOTA_ENCRYPTION_KEY`          | sim (web e worker) | 32 bytes em base64; criptografa secrets e tokens de repositório. **Não perca esta chave.** |
| `PUBLIC_URL`                      | sim                | URL pública do painel (cookies, CSRF, URL do webhook)                                      |
| `GITHUB_WEBHOOK_SECRET`           | não                | segredo HMAC de webhooks criados à mão; com o GitHub App, o app traz o próprio segredo     |
| `BACKUP_DIR` / `BACKUPS_KEPT`     | não                | pasta do backup diário do banco (padrão: `backups/` ao lado dele) e quantos manter (7)     |
| `DATABASE_PATH` / `WORKSPACE_DIR` | não                | banco e diretório temporário de builds                                                     |
| `TRAEFIK_ENABLED`                 | não                | roteia os domínios das apps pelo Traefik do painel                                         |
| `TRAEFIK_ROUTES_DIR`              | com o Traefik      | pasta, compartilhada com o Traefik, onde o worker grava as rotas (`/routes` no Compose)    |
| `NELCOTA_MCP_TOKEN`               | só no processo MCP | token de API com escopo                                                                    |

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
- O worker reage a eventos do Docker (`docker events`) para atualizar o estado dos contêineres na hora;
  a varredura periódica a cada 60 s é só uma rede de segurança.
- Recuperação: jobs têm lease renovado a cada 10 s. Se o worker morrer, o job volta para a fila
  (deploys têm uma nova tentativa) ou falha com mensagem clara; tasks interrompidas são marcadas como falhas.

### Troca de versão sem queda

As rotas das apps ficam em arquivos que o worker grava e o Traefik lê (o _file provider_), um por
projeto. A troca acontece assim:

1. O contêiner novo sobe ao lado do antigo, **sem receber tráfego**.
2. O worker faz o health check direto no contêiner novo. Se falhar, ele é removido e nada muda.
3. O worker troca o arquivo de rotas do projeto, de forma atômica, para apontar só para o novo.
   Daí em diante, toda requisição nova vai para ele.
4. Depois de alguns segundos (o tempo do Traefik aplicar a mudança), o antigo recebe SIGTERM e tem
   até 30 s para terminar as requisições em andamento antes de ser removido.

O teste com Docker real manda requisições sem parar durante uma troca e exige que nenhuma falhe.
Continuam valendo os cuidados de sempre: migrations incompatíveis com a versão anterior quebram o
contêiner antigo enquanto ele ainda responde.

### Health check

1. O contêiner precisa estar `running` e não reiniciar durante a verificação.
2. Se a imagem define `HEALTHCHECK`, o veredito do Docker vale.
3. Senão, com "caminho de health check" configurado, faz `GET http://<ip>:<porta><caminho>` (2xx/3xx);
   sem caminho, uma conexão TCP na porta interna basta.
4. Precisa ficar saudável por 3 s seguidos dentro de `HEALTH_CHECK_TIMEOUT_SECONDS`.

## Vários servidores

O painel pode rodar as aplicações em outras VPSs, deixando a VPS do painel só para ele. Em
**Administração → Servidores**:

1. Clique em **Adicionar servidor** e informe um nome e o IP da VPS (porta e usuário ficam em
   "Avançado"; o padrão é `22` e `nelcota`).
2. O painel mostra um comando. Rode-o **uma vez** na VPS nova, como root ou com sudo. Ele instala o
   Docker (script oficial `get.docker.com`) e o git, cria o usuário `nelcota` no grupo `docker`,
   autoriza a chave do painel e libera para esse usuário túneis locais (`AllowTcpForwarding local`) e
   até 200 canais SSH (`MaxSessions 200`), validando o `sshd_config` com `sshd -t` antes de recarregar.
3. Pronto. Em até 10 segundos o worker conecta, grava a impressão digital da chave SSH do servidor
   (as conexões seguintes exigem a mesma chave), cria a rede, sobe o Traefik com Let's Encrypt
   (portas 80/443) e descobre o IP público.

Quando o primeiro servidor extra fica pronto e a VPS do painel ainda não tem projetos, ela deixa de
receber projetos novos automaticamente. Projetos novos vão para o servidor pronto com menos projetos;
o interruptor **Recebe novos projetos** de cada servidor controla isso.

Como funciona, pensando em desempenho:

- Uma conexão SSH persistente por servidor (biblioteca `ssh2`, dentro do worker): cada comando é um
  canal nela, sem novo handshake. A conexão volta sozinha se cair.
- O clone e o build rodam **na própria VPS** das aplicações: o código vem direto do GitHub para lá e o
  cache do BuildKit fica lá. Nada passa pela VPS do painel.
- O health check usa um túnel pela conexão (`forwardOut`) até o IP do contêiner na rede Docker da VPS.
- As métricas de CPU, memória e disco chegam em uma única ida e volta por coleta.
- Comandos e variáveis vão pelo stdin do canal (`sh -s`), nunca pela linha de comando: segredos não
  aparecem no `ps` da VPS. Timeout e cancelamento matam o processo remoto pelo PID.

**Mover um projeto**: em Ajustes do projeto → Servidor (administradores). O deploy roda no servidor
novo a partir do mesmo commit. O contêiner antigo continua no ar até todos os domínios do projeto
apontarem para o IP do servidor novo (ou por até 24 horas), então nada sai do ar enquanto o DNS muda.
O card de DNS de cada projeto mostra o IP do servidor dele.

A VPS das aplicações não guarda banco, chave de criptografia nem sessões. Em compensação, **a chave SSH
do painel equivale a root nessa VPS** (o usuário está no grupo `docker`): ela fica criptografada no
banco, como os outros segredos.

## Primeiro administrador

Não existe cadastro público nem usuário padrão. Enquanto o painel não tem nenhum admin, a página de
login pede nome, e-mail e senha e cria o primeiro; depois disso ela só serve para entrar. Como quem
abrir o painel primeiro vira admin, crie a conta logo após publicar o painel.

Também dá para criar pelo terminal, sem abrir o navegador:

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

1. **Projetos → Novo projeto**: escolha o repositório na lista (com o GitHub App conectado) ou cole
   a URL HTTPS; nome, identificador e branch são preenchidos. Deixe a porta interna em branco para
   cada build ler o `EXPOSE` do Dockerfile (sem `EXPOSE`, vale a última porta usada ou 3000).
   Dockerfile, contexto e health check ficam em _Build_.
2. **Variáveis**: crie configurações (visíveis) ou secrets (criptografados, nunca exibidos de volta).
   Marque "Disponível no build" para passar como build arg.
3. Clique em **Deploy** e acompanhe os logs ao vivo. O histórico fica em **Deploys**, com commit,
   autor, duração, status e **Rollback** para imagens anteriores ainda disponíveis.
4. Variáveis e domínios salvos são aplicados sozinhos: o painel recria o contêiner a partir da imagem
   atual, sem rebuild. Se já houver um deploy na fila ou rodando, a mudança vai com ele ou logo depois
   dele (nunca depois de uma falha, para não repetir uma configuração quebrada). Desligue em
   **Ajustes → Aplicar mudanças automaticamente** para aplicar à mão com **Redeploy**.
   **Iniciar/Parar/Reiniciar** atuam no contêiner atual.

Segurança de código desconhecido: construir um repositório executa o Dockerfile dele. Projetos
criados por desenvolvedores começam **aguardando aprovação** e só fazem deploy depois que um admin
aprova; trocar o repositório de um projeto aprovado (por um não-admin) exige nova aprovação.

Repositórios privados: com o GitHub App conectado, nada a fazer (veja abaixo). Sem ele, um admin
pode salvar um token de leitura do GitHub em **Ajustes do projeto**; o token do projeto tem
prioridade sobre o do app. Tokens são criptografados em repouso e entregues ao git só pelo
credential helper — nunca em URL, argumento de processo ou log.

## GitHub (deploy automático e repositórios privados)

### GitHub App (recomendado)

Em **Configurações → Sistema → GitHub**, clique em **Conectar ao GitHub** (informe a organização se
o app for dela). O painel abre o GitHub com o app já descrito — só leitura de código, evento de
push e webhook apontando para `<PUBLIC_URL>/api/webhooks/github`. Confirme, escolha os repositórios
e pronto:

- **Novo projeto** lista os repositórios do app;
- repositórios privados são clonados com tokens de instalação de 1 hora, sem token por projeto;
- todo push chega ao painel, sem webhook por repositório.

A chave privada e o segredo do webhook do app ficam criptografados com `NELCOTA_ENCRYPTION_KEY`.
**Desconectar** só faz o painel esquecer o app; apague-o nas configurações do GitHub se quiser. O
`PUBLIC_URL` precisa ser acessível pelo GitHub.

### Webhook manual

Sem o app, configure um webhook por repositório:

1. Defina `GITHUB_WEBHOOK_SECRET` (o `bun run setup` já gera um).
2. No repositório: _Settings → Webhooks → Add webhook_
   - Payload URL: `<PUBLIC_URL>/api/webhooks/github` (também exibida em **Configurações → Sistema**)
   - Content type: `application/json`
   - Secret: o valor de `GITHUB_WEBHOOK_SECRET`
   - Eventos: _Just the push event_
3. Ative "Deploy automático" no projeto.

Os dois jeitos convivem. O endpoint valida a assinatura HMAC SHA-256 (com o segredo do app ou o
manual) sobre o corpo bruto (limite de 1 MB), registra cada
entrega pelo `X-GitHub-Delivery` (reentregas são ignoradas), confere repositório e branch e enfileira
o deploy do **commit exato** do push. Entregas recebidas aparecem em **Configurações → Auditoria**.
O deploy manual funciona independentemente do webhook.

## Domínios e HTTPS

- Domínios por projeto em **Domínios**. Com um _domínio base_ em **Configurações → Organização**
  (ex.: `apps.empresa.com`), cada projeto ganha automaticamente `<slug>.apps.empresa.com`.
- Com `TRAEFIK_ENABLED=true`, o worker grava as rotas de cada projeto: um router por domínio,
  redirecionamento HTTP→HTTPS e certificado Let's Encrypt (`certresolver`). Mudanças de domínio
  são aplicadas sozinhas (veja o passo 4 de [Cadastrar uma aplicação](#cadastrar-uma-aplicação-e-fazer-deploy)).
- Cada domínio mostra se o DNS já aponta para o servidor do projeto: _DNS ok_, _Sem DNS_ ou _DNS em
  outro endereço_ (outro servidor ou um CDN na frente). A checagem se repete a cada minuto.
- O painel continua roteado por labels; as apps, pelos arquivos em `TRAEFIK_ROUTES_DIR`. Apps
  publicadas antes dessa mudança seguem pelas labels antigas até o próximo deploy.

Para testar HTTPS: aponte um registro DNS `A` para a VPS, defina `ACME_EMAIL`, suba o Compose e
acesse o domínio. Sem DNS público (desenvolvimento), deixe `TRAEFIK_ENABLED=false`; o health check
e os logs funcionam normalmente, só não há roteamento externo.

## Alertas

Em **Configurações → Organização**, cole a URL de um webhook do Discord ou do Slack e use **Enviar
alerta de teste**. O painel avisa quando um deploy falha e quando um servidor fica inacessível ou
volta.

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
# abra o PUBLIC_URL e crie o primeiro admin na página de login
```

O Compose sobe **Traefik** (80/443, Let's Encrypt, socket somente leitura), **web** (sem socket,
roda migrations ao iniciar, health check em `/api/health`) e **worker** (único com o socket do
Docker, `stop_grace_period` de 2 min para terminar jobs). Dados persistem no volume `data`
(SQLite e workspaces), as rotas das apps no volume `routes` (gravado pelo worker, lido pelo
Traefik) e os certificados no volume `letsencrypt`.

Ao atualizar uma instalação antiga, rode `docker compose up -d --build` com o `docker-compose.yml`
novo. Nas VPSs, o worker troca sozinho o Traefik antigo pelo que lê arquivos de rota, na próxima
checagem do servidor; os sites daquela VPS ficam fora do ar por alguns segundos nessa troca única. A rede `nelcota` é compartilhada
pelo proxy, pelo worker (para os health checks) e pelas aplicações.

Sem Compose: `bun run build`, depois `bun run db:migrate && bun run start` e `bun run worker`
(por exemplo como serviços systemd).

## Testes e verificação

```bash
bun run check        # formatação, oxlint, TypeScript, knip e testes
bun test             # testes unitários e de integração (SQLite em memória, Docker simulado)
bun run test:docker  # ciclo completo com Docker real: build, health check, start/stop/restart,
                     # rollback, task e limpeza usando fixtures/hello-app (python:3.15-alpine); e
                     # VPSs simuladas (Alpine, Debian 13 e Ubuntu 26.04 com sshd) que recebem o
                     # comando de instalação e um deploy completo por SSH, com roteamento pelo
                     # Traefik
bun run build        # build de produção
```

O teste com Docker real fica fora do `bun run test` e roda só com `bun run test:docker`, porque
constrói imagens e cria contêineres; ele remove tudo o que criou ao final. No GitHub Actions ele roda
em todo PR, ao lado do `check` e do `ui:review`.

O Dependabot abre PRs diários com as versões mais novas de pacotes, actions e imagens Docker; os
que passam em todas as verificações são mesclados sozinhos.

## Backup e restauração do SQLite

O worker faz um backup por dia (às 03:30 UTC, e ao iniciar se o último tiver mais de um dia) em
`BACKUP_DIR`, mantendo os `BACKUPS_KEPT` mais novos. A data do último aparece em **Configurações →
Sistema**.

### Cópia externa (S3)

Um backup no mesmo disco não sobrevive à perda da VPS. Com `BACKUP_S3_BUCKET` e as credenciais
definidos, cada backup também vai para um bucket compatível com S3 (AWS S3, Cloudflare R2,
Backblaze B2…):

| Variável                                                  | Para quê                                                |
| --------------------------------------------------------- | ------------------------------------------------------- |
| `BACKUP_S3_BUCKET`                                        | liga a cópia externa                                    |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | credenciais; obrigatórias com o bucket                  |
| `BACKUP_S3_ENDPOINT` / `BACKUP_S3_REGION`                 | para provedores fora da AWS (ex.: R2 usa região `auto`) |
| `BACKUP_S3_PREFIX`                                        | pasta no bucket (padrão `nelcota/`)                     |
| `BACKUP_S3_KEPT`                                          | quantas cópias manter no bucket (padrão 30)             |

- O arquivo é **criptografado antes de sair** (AES-256-GCM com a `NELCOTA_ENCRYPTION_KEY`), então o
  provedor nunca vê o banco. Guarde a chave fora da VPS: sem ela, nenhum backup é restaurável.
- Use credenciais que só leem e escrevem nesse bucket.
- **Configurações → Sistema → Cópia externa** mostra o último envio. Uma falha não afeta o backup
  local e manda um alerta, se houver webhook de alertas.

Para restaurar, o comando grava o backup num arquivo novo; ele nunca mexe no banco em uso:

```bash
bun run db:restore --list                                  # backups no bucket
bun run db:restore --latest --output ./restaurado.db       # ou --key nelcota/nelcota-….db.enc
# depois: pare web e worker, troque o arquivo do banco por este, remova -wal/-shm antigos e suba
```

### Backup avulso

Para um backup avulso, o banco está em WAL, então use a API de backup do SQLite em vez de copiar o
arquivo:

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
| Webhook retorna 401                         | `GITHUB_WEBHOOK_SECRET` diferente do configurado no GitHub, ou o app foi recriado e o antigo ainda envia           |
| Webhook retorna 503                         | nem GitHub App conectado nem `GITHUB_WEBHOOK_SECRET` definido                                                      |
| "configuração incompleta"                   | falta `NELCOTA_ENCRYPTION_KEY` ou `BETTER_AUTH_SECRET`                                                             |

## Limitações conhecidas

- O comando de instalação é testado automaticamente em Debian 13 e Ubuntu 26.04 limpos (instalando o
  Docker pelo `get.docker.com`) e em Alpine com o pacote `shadow`. Em outras distribuições pode ser
  preciso instalar o Docker ou o `useradd` à mão antes.
- O domínio automático (`<slug>.<domínio base>`) usa um único curinga de DNS: com projetos em
  servidores diferentes, crie um registro `A` por projeto apontando para o IP do servidor dele.
- Somente repositórios GitHub via HTTPS; privados pedem o GitHub App ou um token de leitura (deploy
  keys SSH não implementadas). O app suporta até 20 instalações de 1.000 repositórios na lista.
- Um ambiente (`production`) por projeto; a tabela `environments` já existe para mais ambientes.
- Sem portas publicadas no host: o tráfego entra pelo Traefik.
- Logs de runtime são coletados enquanto o worker está ativo; linhas emitidas com o worker parado são
  recuperadas pelo `docker logs --since` ao voltar, dentro do que o Docker ainda guarda.
- MCP apenas via stdio, na mesma máquina do banco.
- Não há terminal interativo nem limites de CPU/memória por contêiner configuráveis pela interface.
