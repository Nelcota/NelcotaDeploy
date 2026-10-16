# Contrato com o frontend

O ponto de extensão é `web.Register(r chi.Router, services service.Services, development ...bool)`, chamado por `internal/httpapi.New`. A interface em `web/assets` usa as APIs abaixo, com shell HTML escapado e assets locais versionados e comprimidos. A composição de processos fica em `cmd/`; nenhuma regra de negócio deve ir para as páginas.

## Convenções

Todos os métodos recebem `context.Context` como primeiro argumento. Repassar `r.Context()` até o serviço; não criar `context.Background()` em handlers. Os DTOs e interfaces públicos ficam em `internal/service/types.go` e `auth.go`; tipos de `internal/store/dbgen` são exclusivos do backend. Campos JSON usam snake_case. Tempos de entidades são Unix seconds; durações de etapas são milliseconds. IDs são strings opacas. SHA de deploy deve conter os 40 ou 64 caracteres hexadecimais completos.

`service.Services` contém `Apps`, `Deploys`, `Servers`, `Logs`, `Auth`, `Users`, `Settings` e `Audit`. São interfaces e podem ser substituídas por doubles em testes do frontend. O modo dev entrega implementações reais com SQLite e transporte simulado.

`service.CurrentUser(ctx)` devolve `Principal{ID, Email, Name, Role, Scopes, TwoFactorAt, IP}` ou erro Unauthenticated. O middleware carrega o usuário pelo cookie; nunca aceitar usuário/papel de um header ou campo de formulário. `WithPrincipal` é função interna de composição para código confiável, não um mecanismo de login.

## Erros

`*service.Error{Kind, Message}` é inspecionável com `service.Is(err, kind)` ou `errors.As`. HTTP JSON: `{"code":"validation","message":"..."}`. Mapear apenas mensagens tipadas para o usuário; erros internos viram mensagem genérica, sem `err.Error()` de SDKs ou banco.

| Kind | HTTP | Significado |
|---|---:|---|
| Unauthenticated | 401 | Login/desafio/sessão ausente ou inválido |
| Forbidden | 403 | Papel insuficiente, CSRF ou origem recusados |
| NotFound | 404 | Entidade inexistente |
| Validation | 400 | Entrada inválida ou confirmação ausente |
| Conflict | 409 | Conflito de estado/unicidade |
| Unavailable | 503 | Agent ou integração indisponível |

JSON malformado retorna 400; Content-Type inválido, 415; rate limit, 429 com Retry-After. HTTP requests têm limite de corpo de 1 MiB. Os serviços autorizam independentemente dos handlers. `admin` e `member` têm acesso global às apps da instalação; não há equipes/ACL por app nesta versão.

## Serviços e permissões

| Serviço | Métodos | Permissão |
|---|---|---|
| Apps | `List() []App`, `Get(id) App` | Usuário autenticado |
| Apps | `Create(AppInput) App`, `Update(id, AppInput) App`, `Delete(id, confirmed)` | Admin; exclusão exige app parada e nenhuma fila ativa |
| Apps | `Environment(id) []EnvInfo`, `SetEnvironment(id, []EnvInput)` | Admin; lista nunca devolve valores secretos |
| Apps | `Action(id, action, replicas, confirmed)` | Admin; action = start/stop/restart/scale; stop exige confirmação |
| Deploys | `List(appID) []Deployment`, `Get(id) Deployment` | Usuário autenticado |
| Deploys | `Enqueue(DeployInput) Deployment`, `Cancel(id)`, `Rollback(appID, sha) Deployment` | Usuário autenticado |
| Servers | `List() []Server` | Usuário autenticado |
| Servers | `Invite(ServerInput) Invitation`, `Prune(id, scope, confirmed)` | Admin; prune exige confirmação; scope cache/orphan_images |
| Logs | `Read(deployID) []byte`, `Subscribe(topic) events.Subscription` | Usuário autenticado |
| Users | `List() []Principal`, `Create(UserInput) Enrollment` | Admin |
| Settings | `Get() SettingsView`, `Set(key, value)` | Admin; valores sempre cifrados, Get só lista chaves configuradas |
| Audit | `List(limit) []AuditEntry` | Admin; limite 1–1000 |
| Audit | `RecordRequest(method, route, status)` | Infraestrutura HTTP; não chamar nas páginas |
| Auth | Cerimônias de passkey, TOTP, Session e Logout | Regras abaixo |

`SetEnvironment` aplica um patch transacional: cada item cria/substitui uma chave, e `{key,delete:true}` remove a chave. Chaves ausentes permanecem intactas. Isso permite editar segredos sem lê-los. Não enviar `********` como valor; uma máscara nunca representa o segredo anterior. Limites: 200 chaves e 512 KiB de valores cifrados por app.

## DTOs de domínio

- `App`: id, name, server_id, repository, branch, config, desired_sha, revision.
- `AppInput`: name, server_id, repository (HTTPS github.com), branch e `AppConfig`. Troca de server de app existente não é permitida; exige futura operação de migração.
- `AppConfig`: domains[], memory_bytes, nano_cpus, port, health_path, health_timeout (seconds), replicas (1–16), cache_enabled, dockerfile, installation_id, stopped. Defaults: 256 MiB, 1 CPU, porta 8080, `/`, 60 s, uma réplica e `Dockerfile`. Informar cache_enabled explicitamente. `domains` devem ser hosts DNS sem esquema/path/porta.
- `EnvInput`: key, value, build, delete. `build=false`: somente runtime; `build=true`: somente provider de secrets BuildKit, usado pelo Dockerfile com `RUN --mount=type=secret,id=CHAVE`. Nunca transformar em build ARG.
- `EnvInfo`: key, build, configured. Valores não retornam para a UI.
- `Deployment`: id, app_id, sha, message, author, origin, status, queued_at, started_at, finished_at, error_code, clean, cancel_requested, timings (map etapa→ms). Etapas: clone/build/start/healthcheck/route; mapa incompleto enquanto roda. Estados: queued/building/starting/success/failed/cancelled. Não inventar progresso percentual.
- `DeployInput`: app_id, sha, message, author, origin (push/manual/rollback), clean. Para botão normal, origin=manual. Rollback é novo build, não troca para imagem retida.
- `Server`: id, name, wireguard_ip, status, heartbeat_at, build_limit, cache_bytes. Métricas vêm pelo hub.
- `ServerInput`: name, wireguard_ip, build_limit (1–8; default 1), cache_bytes (default 5 GiB). Usar IP exclusivo em 10.77.0.0/24 no instalador padrão.
- `Invitation`: server_id, token, expires_at (RFC3339). Token único, 15 minutos; exibir uma vez e nunca incluir em analytics, logs ou URLs.
- `UserInput`: email, name, role (admin/member). `Enrollment`: user_id, token, expires_at. Convite de usuário também dura 15 minutos.
- `AuditEntry`: id, user_id, action, target, details (JSON), ip, created_at. `SettingsView`: configured[]; nenhum segredo é devolvido.

Settings aceita: github.app_id, github.private_key, github.webhook_secret, github.client_id, github.client_secret. A alternativa preferida é o handshake Manifest abaixo.

## Sessão e CSRF

Cookie de produção `__Host-nelcota`: Secure, HttpOnly, SameSite=Strict, Path=/, sem Domain, validade de uma hora. O token é aleatório e somente seu hash fica no banco. Em dev existe `nelcota_dev` sem Secure, limitado à escuta 127.0.0.1.

`GET /api/session` retorna `{user, csrf_token}`. Para POST/PUT/DELETE autenticados, enviar `Origin` igual à origem configurada e `X-CSRF-Token`. Páginas Go podem obter o token por esse endpoint para requests do navegador; não expor o cookie HttpOnly ao JavaScript. Requisições pré-login são protegidas pela origem e pela cerimônia WebAuthn. Webhook usa HMAC; enrollment de server usa convite de alta entropia e não aceita cookie como autenticação.

O frontend deve pedir confirmação humana e enviar `confirmed=true` para exclusão, stop e prune. O backend não confirma essas operações sozinho. `exec` não existe no protocolo/API.

## WebAuthn JSON e fluxo de navegador

1. Primeiro administrador: `nelcota-panel init --email ...` grava/retorna `Enrollment`, protegido pelo instalador em `/etc/nelcota/first-access.json`. Um admin pode criar outros usuários via Users.Create. Não há signup aberto.
2. `POST /api/auth/register/begin`, corpo `{enrollment_token}`. Para acrescentar passkey à própria conta, usar `{}` com sessão e reautenticação nos últimos cinco minutos. Resposta: `Ceremony{ceremony_id, options, expires_at}`. `options` é o objeto nativo da biblioteca contendo `publicKey`.
3. Converter strings base64url de challenge, user.id e IDs de credenciais em ArrayBuffer. Navegadores com `PublicKeyCredential.parseCreationOptionsFromJSON` podem fazer a conversão nativa de `options.publicKey`.
4. Chamar `navigator.credentials.create({publicKey})`. Serializar o resultado por `credential.toJSON()` quando disponível; no fallback codificar rawId, clientDataJSON e attestationObject em base64url e incluir id, type, transports e clientExtensionResults.
5. `POST /api/auth/register/finish`: `{ceremony_id, credential: <resultado serializado>}`. Registro não faz login automático. Convite e desafio são consumidos uma única vez.
6. `POST /api/auth/login/begin`: `{email}`. Converter `options.publicKey` com `parseRequestOptionsFromJSON`/fallback e chamar `navigator.credentials.get({publicKey})`.
7. `POST /api/auth/login/finish`: `{ceremony_id, credential}` com rawId, clientDataJSON, authenticatorData, signature, userHandle e extensões serializados em base64url. Origem, RP ID, user verification, assinatura e sign counter são verificados no servidor.
8. Sem TOTP, a resposta define cookie e retorna expires_at. Com TOTP, retorna `{requires_totp:true, challenge}` sem criar sessão.
9. `POST /api/auth/totp/verify`: `{challenge, code}`. Só após validação define cookie. Código já usado não pode ser repetido. Buscar `/api/session` e começar navegação autenticada.
10. Ativar TOTP: sessão recente → `POST /api/auth/totp/begin` retorna `{id,url}` otpauth. Mostrar QR/segredo só nessa etapa. `POST /api/auth/totp/finish`: `{id,code}` confirma antes de persistir e revoga sessões, tokens de API e desafios anteriores. Após ativar, fazer novo login com passkey + TOTP; em seguida, gerar recovery codes. Reset e recuperação estão descritos na seção operacional abaixo.
11. `POST /api/auth/logout` revoga sessão e remove cookie.

Não usar challenge em URL/localStorage; manter em memória durante a cerimônia. Não capturar respostas WebAuthn, tokens, env ou otpauth em logs de frontend. O backend testa as cerimônias com autenticador virtual ECDSA; validar também em browsers e passkeys reais.

## GitHub App Manifest

`POST /api/github/manifest` (admin+CSRF) retorna `{action,manifest,expires_at}`. Criar formulário com method=POST, action retornada e campo hidden `manifest=JSON.stringify(manifest)`; submeter no navegador ao GitHub. `action` inclui state aleatório, vinculado ao administrador por dez minutos.

GitHub retorna GET `/api/github/callback?state=...&code=...`. O backend consome state, troca code, cifra as cinco credenciais e devolve apenas `installation_url`. O callback usa state porque SameSite Strict pode omitir o cookie na navegação de retorno. Abrir installation_url para escolher repositórios; informar installation_id na app. O webhook `/api/webhooks/github` valida HMAC SHA-256 em tempo constante e deduplica X-GitHub-Delivery na mesma transação da fila. Check runs são publicados por outbox persistente com retry, sem bloquear eventos do agent.

## Eventos e SSE

`services.Logs.Subscribe(ctx, topic)` retorna `events.Subscription{C,Cancel}`. Sempre `defer sub.Cancel()` e selecionar `ctx.Done()`. Capacidade: 128 eventos. Ao lotar, o hub fecha o canal e desconecta o consumidor; o produtor não espera. `events.Event` contém ID (sequencial por processo), Topic, Kind, Time, Data ([]byte de JSON, imutável). Não modificar Data; copiar se precisar reter/mutar.

| Tópico | Kind | Data |
|---|---|---|
| apps | app.updated | App |
| deployments | deploy.queued / deploy.status | Deployment |
| deploy/ID | deploy.log | `{line,sequence}` |
| deploy/ID | deploy.status | Deployment |
| deploy/ID | deploy.stage | `{stage,duration_ms}` |
| app/ID | runtime.log | `{line,sequence}`; sequence pode ser zero em runtime real |
| servers | server.metrics | `{server_id,metrics}` com cpu_percent, memory_used/total, disk_used/total, network_rx/tx |
| servers | server.offline | `{id}` |
| servers | container.event | Evento de container quando disponibilizado pelo transporte |

Endpoint pronto: `GET /api/events?topic=...`, com cookie da sessão. Usar EventSource, sem token em query string. Keepalive a cada 15 s; timeout de escrita 5 s. A cada keepalive, o backend revalida a sessão ou token e encerra o stream se houver expiração, revogação ou mudança de permissões. Desconexão é esperada: EventSource reconecta e deve recarregar snapshots de apps/deploys/servers e logs já persistidos. IDs SSE não são persistidos e Last-Event-ID não garante replay. Carregar `Logs.Read(deployID)` inicialmente (limite 4 MiB) e então acompanhar o stream; tratar possível sobreposição. Retenção em disco: últimos 50 deploys finalizados por app, arquivos zstd fora do SQLite.

A primeira assinatura de app/ID pede follow dos logs de runtime ao agent; assinaturas compartilham o stream e a última saída cancela o follow. Métricas chegam a cada 15 s. O heartbeat é de cinco segundos e solicita novo estado desejado a cada dez segundos.

## Endpoints de domínio

- Apps: GET/POST `/api/apps`; GET/PUT/DELETE `/api/apps/{id}`; GET/PUT `/api/apps/{id}/env`; POST `/api/apps/{id}/actions` com `{action,replicas,confirmed}`.
- Deploys: GET `/api/apps/{id}/deployments`; POST `/api/deployments`; GET `/api/deployments/{id}`; POST `/api/deployments/{id}/cancel`; GET `/api/deployments/{id}/logs` retorna `{text}`. Para rollback REST, POST deployments com origin=rollback e SHA antigo.
- Servers: GET `/api/servers`; POST `/api/servers/invite`; POST `/api/servers/{id}/prune` com `{scope,confirmed}`. POST `/api/servers/join` é exclusivo do instalador e recebe `{token,wireguard_public_key}`.
- Usuários: GET/POST `/api/users`. Settings: GET `/api/settings`, PUT `/api/settings/{key}` com `{value}`. Auditoria: GET `/api/audit`.
- GET `/healthz` é público, sem detalhes de infraestrutura. `/agent.sh` serve o instalador embutido.

Respostas de sucesso usam HTTP 200. Os serviços podem ser chamados diretamente pelas páginas, evitando round-trip para a própria API.

## Exemplo completo de handler de página

Exemplo Go usando escape automático. O frontend pode substituir `html/template` por templ sem alterar o serviço:

```go
package web

import (
    "errors"
    "html/template"
    "net/http"
    "github.com/go-chi/chi/v5"
    "github.com/nelcota/nelcota-deploy/internal/service"
)

var appsPage = template.Must(template.New("apps").Parse(`<!doctype html>
<html lang="pt-BR"><meta charset="utf-8"><title>Apps</title>
<h1>Apps de {{.User.Name}}</h1><ul>{{range .Apps}}<li>{{.Name}} — {{.Branch}}</li>{{end}}</ul></html>`))

func Register(r chi.Router, services service.Services) {
    r.Get("/apps", func(w http.ResponseWriter, req *http.Request) {
        user, err := service.CurrentUser(req.Context())
        if err != nil {
            http.Redirect(w, req, "/login", http.StatusSeeOther)
            return
        }
        apps, err := services.Apps.List(req.Context())
        if err != nil {
            var domainError *service.Error
            if errors.As(err, &domainError) && domainError.Kind == service.Forbidden {
                http.Error(w, domainError.Message, http.StatusForbidden)
                return
            }
            http.Error(w, "Não foi possível carregar as apps", http.StatusInternalServerError)
            return
        }
        w.Header().Set("Content-Type", "text/html; charset=utf-8")
        data := struct { User service.Principal; Apps []service.App }{user, apps}
        if err := appsPage.Execute(w, data); err != nil { return }
    })
}
```

## Desenvolvimento sem VPS

`make dev-seed` cria/atualiza dados em `.local/dev`. `make dev` executa o painel somente em `http://localhost:8080`, com três apps, servidores, deploys e logs falsos, sem Docker/GitHub. Fazer POST `/api/dev/session` com Origin correto e JSON `{}`; então buscar `/api/session`. O endpoint dev não é registrado no modo serve. O dispatcher simula deploys, logs de runtime e métricas; não representa desempenho real.

## Tokens de API com escopos

Auth também expõe `CreateToken(ctx, TokenInput) APIToken`, `Tokens(ctx) []APIToken`, `RevokeToken(ctx,id)` e `AuthenticateToken(ctx,raw) Principal`. HTTP: GET/POST `/api/tokens`, DELETE `/api/tokens/{id}`. Criar exige admin em sessão interativa com reautenticação de até cinco minutos; um token não pode emitir outro. A listagem/revogação requer sessão interativa. Token bruto só aparece na criação; o banco armazena SHA-256. Validade default 24 horas, máxima 720 horas, com revogação imediata.

`TokenInput`: name, scopes[], ttl_hours. `APIToken`: id, name, scopes, expires_at (Unix seconds), token (só na criação). Usar `Authorization: Bearer ...`; autenticação explícita por header dispensa cookie/CSRF/Origin. Falha em bearer não faz fallback para o cookie. Nunca colocar token em query string.

Escopos: apps:read, apps:write, deploys:read, deploys:write, servers:read, servers:write, logs:read, users:write, settings:write, audit:read. `:write` inclui a leitura do mesmo domínio. Papéis continuam sendo verificados: um escopo não remove a exigência de admin. A autorização ocorre nos serviços, inclusive chamadas diretas. Operações que consultam outros domínios também exigem o escopo de leitura correspondente; para deploy programático, conceder `apps:read` e `deploys:write`. Para logs de deploy, conceder `deploys:read` e `logs:read`; para runtime, `apps:read` e `logs:read`. `users:write` permite criar contas e deve ser tratado como privilégio administrativo elevado.

## Operações administrativas e recuperação

`Services.Operations` expõe List(ctx), Backup(ctx), Update(ctx,version) e Cancel(ctx,batch). Backup e Update retornam jobs persistidos; a UI deve consultar List para acompanhar o resultado. Não há evento SSE de operação. As mutações exigem admin em sessão interativa reautenticada nos últimos cinco minutos e recusam tokens de API; List admite admin com settings:write.

| Método/rota | Entrada | Saída |
|---|---|---|
| GET /api/operations | — | []Operation, últimos 100 |
| POST /api/operations/backup | — | Operation enfileirada |
| POST /api/operations/update | version, ex. v1.2.3 | []Operation em ordem; agents e depois panel |
| POST /api/operations/{batch}/cancel | — | ok; conflito se há etapa em execução |
| PATCH /api/servers/{id}/limits | build_limit, cache_bytes | Server; admin servers:write |
| POST /api/auth/recovery-codes | — | codes[], dez códigos mostrados uma vez |
| POST /api/auth/recovery/verify | challenge, code | LoginResult/cookie; substitui apenas o TOTP após a passkey |
| POST /api/auth/totp/reset | — | ok; revoga sessões/tokens e exige novo login |

Operation: id, batch, kind (backup/update), target (server ID ou panel), version, status (queued/waiting/applied/failed/cancelled), created_at/started_at/finished_at em segundos Unix, error_code público. waiting indica execução; applied é conclusão. Falha interrompe o restante do lote; server offline aguarda ou permite cancelamento enquanto não começou. A atualização de um agent só termina após helper confirmado, versão nova e ready. O painel vem por último e cria um backup prévio. CLI update participa da mesma política de ociosidade.

Auth adiciona RecoveryCodes(ctx), VerifyRecovery(ctx,challenge,code) e ResetTOTP(ctx). A geração/reset exige sessão interativa recente do próprio usuário, sem bearer. Configure TOTP antes de gerar códigos. Após requires_totp, ofereça a alternativa de código de recuperação mantendo o desafio da passkey; nunca envie um código sem esse desafio. Códigos têm uso único e nova geração invalida os anteriores. Reset revoga a sessão corrente: redirecione para login após sucesso.

Servers adiciona UpdateLimits(ctx,id,ServerLimitsInput) e os campos version e ready em Server. BuildLimit aceita 1–8; cache aceita 64 MiB–100 GiB. Mudança chega no snapshot de até dez segundos; builds ativos continuam. ready=false segura novas claims enquanto o agent recupera o estado.

`server.metrics` mantém server_id e metrics. metrics.containers contém até 256 entradas: app_id, container_id, cpu_percent (100% por core), memory_used (sem cache inativo), memory_limit, network_rx, network_tx, pids. Primeira amostra de CPU pode ser zero; valores são snapshots, não série persistida.

S3: PUT /api/settings/backup.s3 recebe value como string JSON com endpoint HTTPS, region, bucket, prefix, access_key, secret_key e session_token opcional. Get só indica a presença da configuração; nunca preencher inputs com um segredo lido. Arquivo 0600 definido por ambiente tem precedência. Backup não oferece download público nem devolve a chave pela API; operação detalhada em operacao-backend.md.


## Interface e contratos acrescentados

- Páginas autenticadas: `/`, `/apps/{id}`, `/servers`, `/settings`, `/security`. Páginas públicas: `/login` e `/register`. O botão de login simulado só aparece no modo dev.
- `GET /api/overview` reúne `apps`, `servers` e o último deployment por app; exige `apps:read`, `servers:read` e `deploys:read`. A consulta de últimos deployments é indexada e não faz uma requisição por app.
- Streams globais exigem `logs:read` e o escopo do tópico (`apps:read`, `servers:read` ou `deploys:read`). `app.deleted` contém `{id}`.
- “Reiniciar” exige app iniciada, envia somente o comando de restart e não altera a revisão. “Parar” e “escalar” modificam apenas seus campos, dentro de transação.
- A exclusão registra uma fila durável para remover logs do disco. A limpeza automática é idempotente, limitada por lote e repetida após erro/reinício; eventos atrasados não recriam logs de uma app removida.
- O callback GitHub redireciona navegações HTML para a instalação da App; clientes JSON continuam recebendo `installation_url`. `state` permanece obrigatório e de uso único.
- Logs de tela mantêm os últimos 256 KiB em memória; pausar não aumenta esse limite. O buffer de eventos durante a leitura inicial também é limitado. Reconexões recarregam snapshots e logs disponíveis, sem prometer replay durável ou ausência de sobreposição.
- A UI conserva sessão/CSRF, desafios, tokens e convites apenas em memória. Apenas a preferência de tema é gravada em localStorage. Segredos são apagados dos diálogos e inputs ao navegar.
- `GET` pode repetir uma única vez após HTTP 429 respeitando `Retry-After`; mutações não são repetidas automaticamente. Assets e páginas não consomem o orçamento do limitador de APIs.
