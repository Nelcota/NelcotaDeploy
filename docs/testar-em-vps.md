# Instalação e homologação do backend em VPS

Roteiro conferido com o código em 2026-10-15. Os comandos de VPS abaixo **não foram executados nesta sessão**. Marque os critérios somente depois do ensaio real.

A instalação automatizada atual usa **duas VPS**: painel e agent de deploy. Os instaladores não combinam os papéis numa única máquina: ambos gerenciam Caddy e wg0 e recusam configurações existentes. Para homologar numa única VPS seria necessária uma instalação manual específica, fora deste roteiro.

Use inicialmente máquinas descartáveis Debian 12 ou Ubuntu 22.04, com systemd e cgroups. Os scripts alteram firewall e SSH. Teste uma segunda conexão SSH por chave e tenha console de recuperação antes de instalar. O SSH deve estar na porta **22**; se usar outra, adapte e revise as regras dos instaladores antes de executá-los. Não execute este roteiro em hosts com Caddy/WireGuard já configurados.

Sequência: [preparação](#1-preparar-nomes-rede-e-artefatos) → [painel](#2-instalar-o-painel) → [acesso](#3-primeiro-acesso-totp-e-token-de-homologação) → [agent](#4-convidar-e-instalar-o-agent) → [deploy](#5-criar-aplicação-descartável-e-executar-o-primeiro-deploy) → [rollback da app](#6-deploy-sob-tráfego-falha-de-saúde-e-rollback-da-aplicação) → [GitHub](#7-github-app-e-webhook-reais) → [backup](#8-backup-e-guarda-da-chave-fora-da-vps) → [restore](#9-restaurar-e-provar-recuperação) → [update](#10-update-assinado-e-espera-por-build-ativo) → [rollback automático](#11-provar-rollback-automático-do-executável) → [rollback manual](#12-rollback-manual-de-desastre) → [validação final](#13-segurança-persistência-e-medição-final).

## 1. Preparar nomes, rede e artefatos

Na estação do operador, com Bash, Git, curl, jq, Python 3 e SSH:

```bash
PANEL_DOMAIN=painel.exemplo.com
APP_DOMAIN=hml.exemplo.com
PANEL_IP=203.0.113.10
AGENT_IP=203.0.113.20
PANEL_SSH="root@$PANEL_IP"
AGENT_SSH="root@$AGENT_IP"
PANEL_URL="https://$PANEL_DOMAIN"
APP_URL="https://$APP_DOMAIN"
RELEASE_BASE=https://releases.exemplo.com/nelcota
INITIAL_VERSION=v1.0.0
NEXT_VERSION=v1.0.1
ROLLBACK_TEST_VERSION=v1.0.2
ADMIN_EMAIL=admin@exemplo.com
REPOSITORY=https://github.com/SEU_USUARIO/nelcota-hml
umask 077
HML_DIR=$(mktemp -d "$HOME/nelcota-hml.XXXXXX")
```

Os IPs/domínios acima são exemplos. Preencha valores reais; não há domínio, chave pública ou release oficial publicado pelo projeto. As três versões são uma sequência de laboratório; para uma instalação existente, escolha versões estáveis posteriores às já instaladas.

- DNS A de `PANEL_DOMAIN` → painel; de `APP_DOMAIN` → agent. Use DNS direto neste primeiro ensaio. Só publique AAAA se IPv6 estiver configurado e testado.
- Painel: TCP 22, 80, 443; UDP 443 e 51820. Pode restringir SSH ao IP do operador e UDP 51820 ao IP do agent no firewall do provedor.
- Agent: TCP 22, 80, 443 e UDP 443. O WireGuard do agent inicia conexão de saída; não há listener público de controle.
- 8080 e 2019 devem ficar em loopback; 8443 do painel, somente em `10.77.0.1`. Não abra 6060/8080/8443/2019 na rede pública.
- Verifique que `10.77.0.0/24` não conflita com a rede das VPS. Sincronize relógios (`timedatectl status`).
- Reserve espaço para BuildKit, imagens e temporários de backup/restore. A slice de builds tem teto de 2 GiB, além da RAM necessária para sistema, Docker e apps. Os limites dos processos painel/agent não representam toda a memória da VPS.

Teste SSH e DNS:

```bash
ssh "$PANEL_SSH" 'id; cat /etc/os-release; timedatectl status'
ssh "$AGENT_SSH" 'id; cat /etc/os-release; timedatectl status'
getent ahosts "$PANEL_DOMAIN"
getent ahosts "$APP_DOMAIN"
```

### Preparar releases assinados na estação de build

Use o toolchain de `go.mod` (atualmente Go 1.26.9), make, protoc, shellcheck, Minisign e dois `buildkitd` oficiais, um para amd64 e outro para arm64. Obtenha-os no [release oficial do BuildKit v0.34.0](https://github.com/moby/buildkit/releases/tag/v0.34.0), valide a procedência/digest e registre os hashes usados. A assinatura Nelcota distribui esses binários; não substitui a verificação inicial de sua origem. Sintaxe de assinatura: [documentação do Minisign](https://jedisct1.github.io/minisign/).

No checkout do NelcotaDeploy:

```bash
go version
make tools
export PATH="$PWD/.tools:$(go env GOPATH)/bin:$PATH"
make build test lint check-generated
install -d -m 0700 "$HOME/.config/nelcota-release"
SIGNING_SECRET="$HOME/.config/nelcota-release/minisign.key"
SIGNING_PUBLIC="$HOME/.config/nelcota-release/minisign.pub"
# Gere somente na primeira vez. Guarde a chave privada e sua senha fora das VPS.
minisign -G -p "$SIGNING_PUBLIC" -s "$SIGNING_SECRET"
SIGNING_KEY=$(sed -n '2p' "$SIGNING_PUBLIC")
# Receita local identificada, com Go 1.26.9, x/net 0.61.0 e go-archive 0.3.0.
# Precisa de govulncheck no PATH; instala-se com:
go install golang.org/x/vuln/cmd/govulncheck@v1.9.0
BUILDKIT_LOCAL="$PWD/.local/buildkit-homologacao"
bash scripts/buildkit-homologacao.sh "$BUILDKIT_LOCAL"
BUILDKIT_AMD64="$BUILDKIT_LOCAL/amd64/buildkitd"
BUILDKIT_ARM64="$BUILDKIT_LOCAL/arm64/buildkitd"
HML_RELEASE_DIR="$HOME/nelcota-releases-hml"
install -d -m 0700 "$HML_RELEASE_DIR"
for version in v1.0.0 v1.0.1 v1.0.2; do
  test ! -e "$HML_RELEASE_DIR/$version" || exit 1
  bash scripts/release.sh "$version" "$SIGNING_SECRET" "$BUILDKIT_AMD64" "$BUILDKIT_ARM64" "$BUILDKIT_LOCAL"
  install -d -m 0755 "$HML_RELEASE_DIR/$version"
  install -m 0644 "dist/$version/"* "$HML_RELEASE_DIR/$version/"
  minisign -Vm "$HML_RELEASE_DIR/$version/checksums.txt" -P "$SIGNING_KEY"
done
```

As versões podem usar o mesmo commit neste laboratório: o objetivo é testar a troca dos executáveis e seus números de versão. Em releases reais, revise também migrações e compatibilidade de protocolo/estado.

O script exige checkout limpo, cria cada release em `dist/VERSÃO/` e recusa sobrescrevê-lo. `build-info.json`, incluído no manifesto assinado, registra commit, toolchain e hashes dos dois BuildKit; `buildkit-build-info.txt` registra os módulos e toolchains desses daemons. Verifique também vulnerabilidades: os binários oficiais v0.34.0 foram compilados antes das correções Go de outubro. Os pacotes já preparados neste ambiente usam uma recompilação com essas correções, descrita em [Releases de homologação](releases-homologacao.md).

Publique **todos** os arquivos de cada diretório em `$RELEASE_BASE/v1.0.0/`, `/v1.0.1/` e `/v1.0.2/`, preservando nomes e conteúdo. O endpoint precisa servir HTTPS diretamente, sem redirecionar os downloads do updater. Não sobrescreva versões publicadas. Exemplo para um host de publicação HTTPS já configurado, cujo usuário tenha permissão nesse diretório:

```bash
RELEASE_SSH=publicador@host-de-releases
ssh "$RELEASE_SSH" 'set -eu
for v in v1.0.0 v1.0.1 v1.0.2; do
  test ! -e "/var/www/nelcota-releases/$v"
  install -d -m 0755 "/var/www/nelcota-releases/$v"
done'
for version in v1.0.0 v1.0.1 v1.0.2; do
  scp "$HML_RELEASE_DIR/$version/"* "$RELEASE_SSH:/var/www/nelcota-releases/$version/"
done
curl --fail --silent --show-error --proto '=https' \
  "$RELEASE_BASE/$INITIAL_VERSION/checksums.txt" -o "$HML_DIR/checksums.txt"
curl --fail --silent --show-error --proto '=https' \
  "$RELEASE_BASE/$INITIAL_VERSION/checksums.txt.minisig" -o "$HML_DIR/checksums.txt.minisig"
minisign -Vm "$HML_DIR/checksums.txt" -P "$SIGNING_KEY"
```

Distribua a chave pública por um canal confiável. Não obtenha a chave de confiança apenas do mesmo download que pretende verificar.

**Aprovar esta etapa:** DNS/rede conferidos, chaves SSH testadas, releases acessíveis com assinatura válida e chave privada ausente das VPS.

## 2. Instalar o painel

Na estação, envie os scripts do checkout revisado:

```bash
scp scripts/install.sh "$PANEL_SSH:/root/nelcota-install.sh"
scp scripts/agent.sh "$AGENT_SSH:/root/nelcota-agent-install.sh"
ssh "$PANEL_SSH"
```

No painel, como root, preencha novamente as variáveis públicas da etapa 1:

```bash
PANEL_DOMAIN=painel.exemplo.com
PANEL_IP=203.0.113.10
ADMIN_EMAIL=admin@exemplo.com
RELEASE_BASE=https://releases.exemplo.com/nelcota
SIGNING_KEY='CHAVE_PUBLICA_MINISIGN_CONFERIDA'
bash -n /root/nelcota-install.sh
bash /root/nelcota-install.sh panel \
  --domain "$PANEL_DOMAIN" --email "$ADMIN_EMAIL" \
  --wg-endpoint "$PANEL_IP:51820" \
  --release-url "$RELEASE_BASE/v1.0.0" --signing-key "$SIGNING_KEY"
nelcota-panel version
systemctl is-active nelcota-panel wg-quick@wg0 caddy
systemctl is-enabled nelcota-panel nelcota-panel-update.path nelcota-firewall.service
curl --fail http://127.0.0.1:8080/healthz
ss -lntup
wg show wg0
journalctl -u nelcota-panel -n 80 --no-pager
```

O convite inicial está em `/etc/nelcota/first-access.json`, com 15 minutos de validade. Na estação, copie-o para arquivo privado, sem imprimir o token:

```bash
ssh "$PANEL_SSH" 'cat /etc/nelcota/first-access.json' > "$HML_DIR/first-access.json"
chmod 0600 "$HML_DIR/first-access.json"
curl --fail --silent --show-error "$PANEL_URL/healthz"
```

**Aprovar:** versão `v1.0.0`, serviços ativos, HTTPS válido sem `-k`, HTTP interno em loopback e RPC em `10.77.0.1:8443`. Registre a passkey imediatamente. Se o convite expirar antes do primeiro registro, interrompa esse ensaio e refaça a instalação vazia/snapshot inicial; `init` não é um comando de renovação de convite.

## 3. Primeiro acesso, TOTP e token de homologação

A interface já oferece login, registro, TOTP e administração. Para os roteiros de API direta abaixo, abra **a origem HTTPS do painel** em um navegador com passkeys, abra o console e cole o conteúdo de [`scripts/homologacao/browser.js`](../scripts/homologacao/browser.js). Leia esse helper antes de colá-lo. Ele usa somente APIs da mesma origem; não é necessário frontend externo. Este helper é opcional para homologar as APIs e não substitui a interface.

Execute no console, em sequência:

```javascript
await N.register();       // Cole o token do arquivo privado no diálogo, sem console.log.
await N.login();          // Passkey com verificação do usuário.
await N.enableTOTP();     // Cadastre otpauth no autenticador e informe o código.
await N.login();          // Ativação de TOTP revoga sessões e tokens anteriores.
await N.recoveryCodes();  // Guarde os códigos num cofre; são mostrados uma vez.
await N.makeToken();      // Copie o token do diálogo para a leitura oculta abaixo.
N.tokenId;                // Anote este ID não secreto para revogar o mesmo token ao final.
```

O helper mantém CSRF apenas em memória. Se recarregar a página, cole-o novamente. Se houver um cookie HttpOnly já revogado e o login retornar CSRF inválido, remova o cookie `__Host-nelcota` nos DevTools/armazenamento do site e tente novamente. Em 429, aguarde o Retry-After e refaça a cerimônia. Nunca copie cookies/tokens para URLs ou evidências públicas.

Na estação, guarde o bearer num arquivo 0600, sem valor secreto no histórico ou argumentos do curl:

```bash
read -r -s -p 'Token de homologação: ' HML_TOKEN
printf '\n'
printf 'header = "Authorization: Bearer %s"\n' "$HML_TOKEN" > "$HML_DIR/auth.curl"
unset HML_TOKEN
chmod 0600 "$HML_DIR/auth.curl"
api() {
  local path=$1
  shift
  curl --fail-with-body --silent --show-error --config "$HML_DIR/auth.curl" \
    --header 'Content-Type: application/json' "$PANEL_URL$path" "$@"
}
api /api/servers | jq .
```

O bearer dura uma hora. Em 401, faça novo login no navegador, gere outro token e atualize o arquivo. Backup/update/cancelamento de lote exigem **sessão interativa recente**, não esse bearer. Nos exemplos dessas operações use `N.api` ou a CLI local.

**Aprovar:** registro e login reais, TOTP requerido, recovery codes guardados e token limitado funcionando. Não reutilize o código usado para ativar TOTP; espere um código novo.

## 4. Convidar e instalar o agent

Na estação, gere o convite e envie somente o arquivo de token:

```bash
api /api/servers/invite --request POST --data-binary \
  '{"name":"deploy-hml","wireguard_ip":"10.77.0.2","build_limit":1,"cache_bytes":5368709120}' \
  > "$HML_DIR/invitation.json"
SERVER_ID=$(jq -er .server_id "$HML_DIR/invitation.json")
jq -er .token "$HML_DIR/invitation.json" > "$HML_DIR/join-token"
chmod 0600 "$HML_DIR/join-token"
scp "$HML_DIR/join-token" "$AGENT_SSH:/root/nelcota-join"
ssh "$AGENT_SSH"
```

No agent, como root, dentro da validade de 15 minutos:

```bash
PANEL_URL=https://painel.exemplo.com
RELEASE_BASE=https://releases.exemplo.com/nelcota
SIGNING_KEY='CHAVE_PUBLICA_MINISIGN_CONFERIDA'
chmod 0600 /root/nelcota-join
bash -n /root/nelcota-agent-install.sh
bash /root/nelcota-agent-install.sh \
  --panel-url "$PANEL_URL" --join-file /root/nelcota-join \
  --release-url "$RELEASE_BASE/v1.0.0" --signing-key "$SIGNING_KEY"
rm /root/nelcota-join
nelcota-agent version
systemctl is-active nelcota-agent nelcota-buildkit docker caddy wg-quick@wg0
systemctl is-enabled nelcota-agent nelcota-agent-update.path
wg show wg0
ss -lntup
iptables -S DOCKER-USER
iptables -S NELCOTA-ISOLATION
ip6tables -S NELCOTA-INPUT
journalctl -u nelcota-agent -u nelcota-buildkit -n 80 --no-pager
```

Na estação:

```bash
api /api/servers > "$HML_DIR/servers.json"
jq --arg id "$SERVER_ID" '.[] | select(.id==$id) | {id,status,ready,version,heartbeat_at}' "$HML_DIR/servers.json"
```

**Aprovar:** `online`, `ready=true`, versão `v1.0.0`, heartbeat recente e handshake WireGuard nos dois hosts. Não imprima `/etc/nelcota-agent/join.json`: contém a chave privada mTLS. Reutilizar o convite deve ser recusado; não repita o instalador sobre a máquina instalada.

## 5. Criar aplicação descartável e executar o primeiro deploy

Na estação, crie um repositório **de teste** vazio no GitHub, acessível em `$REPOSITORY`. Para o primeiro ensaio, pode ser público e usar installation_id=0. Para repositório privado/check runs/webhook, configure o GitHub App na etapa 7.

Em um diretório novo da estação:

```bash
mkdir "$HML_DIR/app-repo"
cd "$HML_DIR/app-repo"
git init -b main
git remote add origin "$REPOSITORY"
mkdir public
printf 'v1\n' > public/index.html
printf 'ok\n' > public/health
cat > start.sh <<'SH'
#!/bin/sh
set -eu
# Valor artificial usado somente para verificar a máscara dos logs.
printf 'hml-runtime-secret=%s\n' "${HML_SECRET:-unset}"
exec httpd -f -p 8080 -h /www
SH
cat > Dockerfile <<'DOCKER'
FROM busybox:1.37.0
RUN --mount=type=secret,id=HML_BUILD_SECRET cat /run/secrets/HML_BUILD_SECRET
COPY --chmod=0555 public/ /www/
COPY --chmod=0555 start.sh /start.sh
USER 65532:65532
EXPOSE 8080
CMD ["/start.sh"]
DOCKER
chmod 0755 start.sh
git add Dockerfile start.sh public
git commit -m 'Adiciona app de homologação v1'
git push -u origin main
SHA_V1=$(git rev-parse HEAD)
```

A base coincide com a fixture de integração local. É uma app descartável; valide/pine a base adequada antes de usar uma app real. O chmod explícito permite leitura como UID 65532 mesmo com umask privado no checkout.

Crie app e dois sentinelas **artificiais**, nunca credenciais reais:

```bash
jq -n --arg server "$SERVER_ID" --arg repo "$REPOSITORY" --arg domain "$APP_DOMAIN" \
  '{name:"hml-backend",server_id:$server,repository:$repo,branch:"main",config:{domains:[$domain],memory_bytes:134217728,nano_cpus:500000000,port:8080,health_path:"/health",health_timeout:30,replicas:1,cache_enabled:true,dockerfile:"Dockerfile",installation_id:0,stopped:false}}' \
  > "$HML_DIR/app-input.json"
api /api/apps --request POST --data-binary "@$HML_DIR/app-input.json" > "$HML_DIR/app.json"
APP_ID=$(jq -er .id "$HML_DIR/app.json")
python3 - "$HML_DIR" <<'PY'
import json, pathlib, secrets, sys
p = pathlib.Path(sys.argv[1])
values = [{"key":"HML_SECRET","value":secrets.token_hex(24),"build":False},
          {"key":"HML_BUILD_SECRET","value":secrets.token_hex(24),"build":True}]
(p/'env.json').write_text(json.dumps(values))
(p/'sentinels.txt').write_text('\n'.join(v['value'] for v in values)+'\n')
PY
api "/api/apps/$APP_ID/env" --request PUT --data-binary "@$HML_DIR/env.json"
deploy() {
  jq -n --arg app "$APP_ID" --arg sha "$1" --arg origin "${2:-manual}" \
    '{app_id:$app,sha:$sha,origin:$origin,clean:false}' > "$HML_DIR/deploy-input.json"
  api /api/deployments --request POST --data-binary "@$HML_DIR/deploy-input.json" > "$HML_DIR/deploy.json"
  jq -er .id "$HML_DIR/deploy.json"
}
wait_deploy() {
  local id=$1
  for ((attempt=0; attempt<300; attempt++)); do
    api "/api/deployments/$id" > "$HML_DIR/deployment-$id.json" || return 1
    case $(jq -r .status "$HML_DIR/deployment-$id.json") in
      success) return 0;;
      failed|cancelled) jq '{id,status,error_code,timings}' "$HML_DIR/deployment-$id.json"; return 1;;
    esac
    sleep 2
  done
  printf 'Timeout aguardando deploy %s\n' "$id" >&2
  return 1
}
DEPLOY_V1=$(deploy "$SHA_V1")
wait_deploy "$DEPLOY_V1"
curl --fail --silent --show-error "$APP_URL/"
curl --fail --silent --show-error "$APP_URL/health"
api "/api/deployments/$DEPLOY_V1/logs" > "$HML_DIR/build-logs.json"
```

O cold build pode levar mais tempo por download de base/ACME. `wait_deploy` falha no terminal se o deploy falhar; não continue para a próxima etapa sem resolver.

Para acompanhar eventos por 20 segundos na estação (exit 28 por timeout é esperado):

```bash
curl --silent --show-error --no-buffer --max-time 20 --config "$HML_DIR/auth.curl" \
  --get --data-urlencode "topic=app/$APP_ID" "$PANEL_URL/api/events" \
  > "$HML_DIR/runtime.sse"
if grep -qFf "$HML_DIR/sentinels.txt" "$HML_DIR/build-logs.json" "$HML_DIR/runtime.sse"; then
  printf 'FALHA: sentinela apareceu sem máscara\n' >&2
else
  printf 'Nenhuma sentinela em claro nos logs capturados; confira também [REDACTED].\n'
fi
```

No agent, informe o APP_ID não secreto e inspecione sem imprimir Config.Env:

```bash
APP_ID=ID_COPIADO_DA_ETAPA_ANTERIOR
CID=$(docker ps -q --filter "label=nelcota.app=$APP_ID" | head -n 1)
test -n "$CID"
docker inspect --format '{{.Config.User}} ro={{.HostConfig.ReadonlyRootfs}} caps={{json .HostConfig.CapDrop}} security={{json .HostConfig.SecurityOpt}} ports={{json .HostConfig.PortBindings}} mem={{.HostConfig.Memory}} cpu={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}}' "$CID"
docker port "$CID"
```

Confira também o ambiente/histórico da **imagem**, que não deve conter as sentinelas (runtime env no container é esperado). Na estação, envie somente os valores artificiais para um arquivo privado no agent:

```bash
scp "$HML_DIR/sentinels.txt" "$AGENT_SSH:/root/nelcota-hml-sentinels.txt"
```

No agent, com o CID acima:

```bash
umask 077
IMAGE_ID=$(docker inspect --format '{{.Image}}' "$CID")
docker image inspect --format '{{json .Config.Env}}' "$IMAGE_ID" > /root/nelcota-hml-image-env.txt
docker history --no-trunc "$IMAGE_ID" > /root/nelcota-hml-image-history.txt
if grep -qFf /root/nelcota-hml-sentinels.txt /root/nelcota-hml-image-env.txt /root/nelcota-hml-image-history.txt; then
  printf 'FALHA: sentinela presente no ambiente/histórico da imagem\n' >&2
fi
```

Esses checks não substituem a revisão de camadas/Dockerfile: uma app real não deve copiar build secrets para arquivos de sua imagem.

**Aprovar:** deployment `success`, `/` retorna `v1`, `/health` retorna 200, sentinelas aparecem mascaradas nas capturas e nenhum valor real foi usado. Container com UID 65532, filesystem readonly, ALL em CapDrop, no-new-privileges, PIDs=128, memória/CPU limitadas e nenhuma porta publicada.

## 6. Deploy sob tráfego, falha de saúde e rollback da aplicação

Na estação, com `api`, `deploy` e `wait_deploy` ainda definidos:

```bash
cd "$HML_DIR/app-repo"
printf 'v2\n' > public/index.html
git add public/index.html
git commit -m 'Publica app v2'
git push
SHA_V2=$(git rev-parse HEAD)
# Inicie antes de disparar o deploy. Cada resultado deve ser v1 ou v2, com HTTP 2xx.
(
  for ((i=0; i<600; i++)); do
    if body=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 5 "$APP_URL/" 2>>"$HML_DIR/traffic-errors.log"); then
      case "$body" in v1|v2) printf 'OK %s\n' "$body";; *) printf 'BAD_BODY\n';; esac
    else printf 'FAIL\n'; fi
    sleep 0.2
  done
) > "$HML_DIR/traffic.log" &
TRAFFIC_PID=$!
DEPLOY_V2=$(deploy "$SHA_V2")
wait_deploy "$DEPLOY_V2"
wait "$TRAFFIC_PID"
if grep -Eq '^(FAIL|BAD_BODY)$' "$HML_DIR/traffic.log"; then
  printf 'FALHA durante troca; examine traffic.log e traffic-errors.log\n' >&2
fi
curl --fail --silent --show-error "$APP_URL/"
```

Guarde o ID do container/imagem v2 para comparar depois. Teste uma candidata que não passa saúde:

```bash
printf 'bad\n' > public/index.html
git rm public/health
git add public/index.html
git commit -m 'Candidata com healthcheck inválido'
git push
SHA_BAD=$(git rev-parse HEAD)
DEPLOY_BAD=$(deploy "$SHA_BAD")
if wait_deploy "$DEPLOY_BAD"; then
  printf 'FALHA: candidata inválida foi aprovada\n' >&2
fi
api "/api/deployments/$DEPLOY_BAD" | jq '{id,status,error_code}'
curl --fail --silent --show-error "$APP_URL/"
```

Esperado: candidata `failed`, resposta pública continua `v2`; container/imagem candidatos não ficam ativos e a rota anterior permanece. Um `failed` aqui é o resultado correto do teste negativo.

Rollback da app é **um novo build do SHA anterior**, não uma troca instantânea de imagem:

```bash
DEPLOY_ROLLBACK=$(deploy "$SHA_V1" rollback)
wait_deploy "$DEPLOY_ROLLBACK"
curl --fail --silent --show-error "$APP_URL/"
```

**Aprovar:** zero erros no ensaio de tráfego, v2 publicada, candidata recusada mantendo v2, e rollback terminou `success` servindo v1. Esse teste de requisições curtas não prova streaming/requests longos: repita com as características reais da app; a drenagem atual é de 5 segundos.

Testes adicionais de pipeline:

- Cancelamento: acrescente `RUN sleep 60` ao Dockerfile de teste, publique outro SHA, inicie deploy com `clean:true` e aguarde `building`; execute `api "/api/deployments/$ID/cancel" --request POST`. Deve chegar a `cancelled`, limpar o build temporário e manter a versão pública anterior. Restaure o Dockerfile antes dos demais ensaios.
- Coalescing: com um build deliberadamente lento ocupando o server, enfileire três SHAs diferentes sem esperar entre eles. Os dois queued antigos devem virar `cancelled`; só o último queued deve executar depois do ativo. Sem esse bloqueio, o primeiro pode ser claimed antes do próximo POST.
- Réplicas: `api "/api/apps/$APP_ID/actions" --request POST --data-binary '{"action":"scale","replicas":2}'`; verificar duas réplicas, depois repetir com 1. Testar stop/start usando `{"action":"stop","confirmed":true}` e `{"action":"start"}`.
- Recovery: mate apenas o container desta app em janela de teste (`docker kill "$CID"`) e observe uma réplica saudável ser criada. Reinicie painel/agent separadamente; depois faça reboot de cada VPS, uma por vez. Revalide SSH, firewall, WG, `online/ready`, rota e app. Não use docker prune global.

## 7. GitHub App e webhook reais

No navegador, faça `await N.login()` para autenticação recente e execute:

```javascript
await N.githubManifest();
```

Isso submete o formulário de Manifest ao GitHub. No callback, o backend retorna JSON com `installation_url`; abra essa URL e instale o App **somente no repo de homologação**. Registre o installation ID da instalação e aplique-o à app:

```bash
INSTALLATION_ID=12345678
jq --argjson installation "$INSTALLATION_ID" '.config.installation_id=$installation' \
  "$HML_DIR/app-input.json" > "$HML_DIR/app-private.json"
api "/api/apps/$APP_ID" --request PUT --data-binary "@$HML_DIR/app-private.json" > "$HML_DIR/app.json"
```

Faça um push válido restaurando a saúde da fixture:

```bash
cd "$HML_DIR/app-repo"
git restore --source "$SHA_V2" -- public
git add public
git commit -m 'Restaura healthcheck e valida webhook'
git push
SHA_PUSH=$(git rev-parse HEAD)
api "/api/apps/$APP_ID/deployments" | jq --arg sha "$SHA_PUSH" '.[] | select(.sha==$sha) | {id,sha,origin,status}'
```

Confirme que surge deploy `origin=push`, que termina em success e que o GitHub recebe o check run com o SHA exato. Reentregue a mesma delivery no GitHub e confirme que não duplica deploy. Um webhook com HMAC inválido deve ser recusado. Não desabilite a assinatura para fazer o ensaio passar. Deixe novamente a app num commit saudável antes dos testes de manutenção.

## 8. Backup e guarda da chave fora da VPS

No painel, como root:

```bash
install -d -m 0700 -o nelcota -g nelcota /var/lib/nelcota/backups
BACKUP="/var/lib/nelcota/backups/hml-$(date -u +%Y%m%dT%H%M%SZ).nbk"
runuser -u nelcota -- /usr/local/bin/nelcota-panel backup \
  --output "$BACKUP" --key-file /etc/nelcota/backup.key
stat -c '%a %U:%G %s %n' "$BACKUP"
sha256sum "$BACKUP"
# Deve falhar: restore exige painel parado. Capture o exit code como evidência.
if /usr/local/bin/nelcota-panel restore "$BACKUP" --key-file /etc/nelcota/backup.key --replace; then
  printf 'FALHA: restore aceitou painel ativo\n' >&2
else
  printf 'Restore ativo recusado, como esperado.\n'
fi
```

Na estação, informe o caminho exato do arquivo criado. Guarde arquivo e chave em locais separados:

```bash
BACKUP_REMOTE=/var/lib/nelcota/backups/hml-DATA_UTC.nbk
scp "$PANEL_SSH:$BACKUP_REMOTE" "$HML_DIR/panel.nbk"
HML_KEY_DIR=$(mktemp -d "$HOME/nelcota-keys.XXXXXX")
ssh "$PANEL_SSH" 'cat /etc/nelcota/backup.key' > "$HML_KEY_DIR/backup.key"
chmod 0600 "$HML_KEY_DIR/backup.key"
sha256sum "$HML_DIR/panel.nbk"
```

Mova a chave para um cofre/offline; não a envie ao bucket que contém o backup. Compare o hash do arquivo baixado com o do painel. A chave é raw de 32 bytes; não a imprima nem a edite como texto.

Para homologar o job de backup pela API, faça login recente no navegador:

```javascript
await N.login();
var backupJob = await N.api('/api/operations/backup', 'POST', {});
console.table((await N.api('/api/operations')).filter(j => j.id === backupJob.id));
```

Repita a consulta até `applied`; `queued` ou `waiting` não significam conclusão. O arquivo fica em `/var/lib/nelcota/backups/manual-ID.nbk`. O automático diário usa `nelcota-AAAA-MM-DD.nbk`, retenção local de sete dias e `.ok` após upload opcional bem-sucedido. Backups manuais não entram nessa retenção.

### Upload S3 opcional

No painel, crie primeiro o arquivo privado abaixo (somente se ainda não existir), depois preencha-o em um editor local. Não coloque credenciais em comandos ou evidências:

```bash
umask 077
test ! -e /etc/nelcota/backup-s3.json || exit 1
install -o nelcota -g nelcota -m 0600 /dev/null /etc/nelcota/backup-s3.json
```

Formato de `/etc/nelcota/backup-s3.json`:

```json
{"endpoint":"https://SEU_ENDPOINT","region":"SUA_REGIAO","bucket":"SEU_BUCKET","prefix":"homologacao","access_key":"SUA_CHAVE","secret_key":"SEU_SEGREDO"}
```

```bash
chown nelcota:nelcota /etc/nelcota/backup-s3.json
chmod 0600 /etc/nelcota/backup-s3.json
# Somente se ainda não houver definição; para mudar uma existente, edite-a.
! grep -q '^NELCOTA_BACKUP_S3_CONFIG=' /etc/nelcota/panel.env || exit 1
printf '%s\n' 'NELCOTA_BACKUP_S3_CONFIG=/etc/nelcota/backup-s3.json' >> /etc/nelcota/panel.env
systemctl restart nelcota-panel
runuser -u nelcota -- /usr/local/bin/nelcota-panel backup \
  --output "/var/lib/nelcota/backups/s3-hml-$(date -u +%Y%m%dT%H%M%SZ).nbk" \
  --key-file /etc/nelcota/backup.key --s3-config /etc/nelcota/backup-s3.json
```

Baixe o objeto pelo cliente administrativo do seu storage, compare SHA-256 e restaure essa cópia. Em homologação, provoque credencial inválida temporariamente: upload/job deve falhar sem revelar o segredo e conservar o arquivo local para nova tentativa. Corrija a configuração antes de continuar. O worker diário tenta novamente por hora; CLI com `--s3-config` é uma tentativa independente.

**Aprovar:** snapshot online concluído, restore ativo recusado, cópia e chave fora da VPS, hash igual e, quando configurado, objeto remoto recuperável. `.nbk` cobre banco/configuração do painel; não cobre imagens Docker, volumes/dados das apps, sistema operacional, units, Caddy ou o estado/identidade do agent. Mantenha backup separado desses recursos conforme sua aplicação.

## 9. Restaurar e provar recuperação

Primeiro faça este ensaio no mesmo par de VPS de homologação, usando a **mesma versão** do executável que criou o backup, sem rollout pendente ou builds ativos. Use um backup CLI obtido nesse estado estável. Em paralelo, a app já publicada no agent deve continuar respondendo mesmo com o painel parado.

Selecione um backup que já contenha a configuração S3, se a tiver habilitado. Depois desse backup e antes de parar o painel, na estação acrescente um marcador artificial para provar que houve retorno ao snapshot:

```bash
api "/api/apps/$APP_ID/env" --request PUT --data-binary \
  '[{"key":"HML_AFTER_BACKUP","value":"somente-depois-do-snapshot","build":false}]'
api "/api/apps/$APP_ID/env" | jq -e 'any(.[]; .key=="HML_AFTER_BACKUP")'
```

No painel, como root:

```bash
BACKUP=/var/lib/nelcota/backups/hml-DATA_UTC.nbk
systemctl stop nelcota-panel-update.path nelcota-panel-update.service
systemctl stop nelcota-panel
nelcota-panel restore "$BACKUP" --key-file /etc/nelcota/backup.key --replace
stat -c '%a %U:%G %n' /var/lib/nelcota/panel.db /etc/nelcota/master.key
# Não remova o marcador para forçar startup: se existir, repita o restore.
test ! -e /var/lib/nelcota/restore-in-progress
systemctl start nelcota-panel
systemctl start nelcota-panel-update.path
curl --fail http://127.0.0.1:8080/healthz
journalctl -u nelcota-panel -n 80 --no-pager
runuser -u nelcota -- /usr/local/bin/nelcota-panel backup \
  --output "/var/lib/nelcota/backups/apos-restore-$(date -u +%Y%m%dT%H%M%SZ).nbk" \
  --key-file /etc/nelcota/backup.key
```

Na estação, refaça login, atualize o bearer se tiver sido criado depois do snapshot e confirme apps, variáveis (somente presença, sem leitura de valores), deploys, auditoria e `online/ready`. Faça outro deploy saudável para provar que a master key, certificados e comunicação funcionam. Confira a cópia S3 e o backup posterior. `.before-restore` conserva arquivos anteriores; remova-os somente após aceitar a recuperação.

```bash
api "/api/apps/$APP_ID/env" | jq -e 'all(.[]; .key!="HML_AFTER_BACKUP")'
```

O marcador deve desaparecer, e as chaves anteriores HML_SECRET/HML_BUILD_SECRET devem continuar configuradas.

Teste negativo sem tocar a instalação: em diretório isolado, tente restaurar uma cópia truncada e com chave incorreta. Não deve surgir `panel.db` no destino:

```bash
umask 077
TEST_ROOT=$(mktemp -d /root/nelcota-restore-negativo.XXXXXX)
cp "$BACKUP" "$TEST_ROOT/truncado.nbk"
truncate -s -20 "$TEST_ROOT/truncado.nbk"
if nelcota-panel restore "$TEST_ROOT/truncado.nbk" --data-dir "$TEST_ROOT/data" \
    --config-dir "$TEST_ROOT/config" --key-file /etc/nelcota/backup.key; then
  printf 'FALHA: backup truncado aceito\n' >&2
fi
test ! -e "$TEST_ROOT/data/panel.db"
nelcota-panel backup-keygen --output "$TEST_ROOT/chave-errada.key"
if nelcota-panel restore "$BACKUP" --data-dir "$TEST_ROOT/wrong-data" \
    --config-dir "$TEST_ROOT/wrong-config" --key-file "$TEST_ROOT/chave-errada.key"; then
  printf 'FALHA: chave incorreta aceita\n' >&2
fi
test ! -e "$TEST_ROOT/wrong-data/panel.db"
```

### Restaurar o painel numa VPS substituta

Mantenha a VPS antiga desligada para não haver dois painéis com a mesma identidade. Instale serviços/executável revisados na substituta, pare o painel e o updater e restaure banco/config com a chave externa usando `--replace`. Aplique os donos `nelcota:nelcota` dos diretórios restaurados. Preserve o domínio/origem original para manter as passkeys válidas e ajuste seu DNS/endereço público.

```bash
chown -R nelcota:nelcota /etc/nelcota /var/lib/nelcota
```

A configuração do host não vem inteira do `.nbk`: restaure/revise units, trust de releases, Caddy, firewall e ambiente. O instalador cria uma nova identidade WG; após restaurar a configuração protegida antiga, aplique a chave correta:

```bash
systemctl stop nelcota-panel
wg set wg0 private-key /etc/nelcota/wg.key
wg show wg0 public-key
cat /etc/nelcota/wg.pub
# As duas chaves públicas acima devem coincidir.
systemctl start nelcota-panel
# Os peers cadastrados são repostos pelo painel ao iniciar.
wg-quick save wg0
```

O endpoint de cada agent deve continuar chegando ao painel. Se mudou de IP, atualize DNS/Endpoint de forma controlada; se mudou de domínio, a migração das passkeys exige outro plano. Certificados/fingerprints do agent precisam corresponder ao snapshot: uma rotação posterior ao backup pode impedir reconexão. Preserve uma cópia coordenada de `/etc/nelcota-agent`, `/var/lib/nelcota-agent` e da configuração WG do agent em backup próprio; não apague certificados nem desative o pinning para contornar esse caso. A recuperação de uma identidade divergente deve ser ensaiada antes de declarar DR completo aprovado.

**Aprovar:** login e segredos utilizáveis, peers restaurados, app acessível, novo deploy e novo backup funcionando; cópias inválidas recusadas antes de instalar o banco.

## 10. Update assinado e espera por build ativo

Antes do update, espere a fila ficar vazia e guarde rollback independente do `.previous`. No painel, como root:

```bash
install -d -m 0700 /root/nelcota-hml
nelcota-panel version > /root/nelcota-hml/panel-before.json
install -m 0755 /usr/local/bin/nelcota-panel /root/nelcota-hml/nelcota-panel.before
PRE_UPDATE_BACKUP="/var/lib/nelcota/backups/pre-hml-update-$(date -u +%Y%m%dT%H%M%SZ).nbk"
runuser -u nelcota -- /usr/local/bin/nelcota-panel backup \
  --output "$PRE_UPDATE_BACKUP" --key-file /etc/nelcota/backup.key
printf '%s\n' "$PRE_UPDATE_BACKUP" > /root/nelcota-hml/pre-update-backup.path
```

No agent, como root:

```bash
install -d -m 0700 /root/nelcota-hml
nelcota-agent version > /root/nelcota-hml/agent-before.json
install -m 0755 /usr/local/bin/nelcota-agent /root/nelcota-hml/nelcota-agent.before
sha256sum /usr/local/bin/nelcota-agent > /root/nelcota-hml/agent-before.sha256
```

Guarde essas cópias e o backup fora das VPS também. Congele pushes/deploys durante a janela de rollback; restauração de banco retorna ao estado desse instante.

Para provar espera por build, inicie primeiro um build lento controlado da app de teste e confirme `building`. Depois, **no painel**, solicite o rollout:

```bash
runuser -u nelcota -- /usr/local/bin/nelcota-panel update v1.0.1
```

Alternativa pelo navegador, após login recente — execute **uma alternativa só**, pois update pendente impede duplicação:

```javascript
await N.login();
var rollout = await N.api('/api/operations/update', 'POST', {version: 'v1.0.1'});
console.table(rollout);
```

A CLI apenas enfileira; exit 0 não significa instalado. Acompanhe da estação:

```bash
api /api/operations | jq '.[] | {id,batch,target,version,status,error_code}'
```

E em cada VPS:

```bash
# Painel
journalctl -u nelcota-panel-update.service -u nelcota-panel -n 100 --no-pager
cat /var/lib/nelcota/update/result.json
nelcota-panel version
# Agent (outra VPS)
journalctl -u nelcota-agent-update.service -u nelcota-agent -n 100 --no-pager
cat /var/lib/nelcota-agent/update/result.json
nelcota-agent version
```

**Aprovar:** enquanto há build, o agent não é reiniciado; novos builds no destino aguardam. Depois, cada agent fica na nova versão e ready, e o painel atualiza por último. Todos os jobs do lote chegam a `applied`; helper registra `applied`, há backup prévio do painel, app continua acessível e novo deploy funciona. Offline segura a fila; `queued/waiting` não é aprovação. Dê ao helper até dez minutos e ao coordenador até doze para concluir/falhar; monitore logs em caso de timeout.

O updater não atualiza Docker, Caddy ou BuildKit. Updates exigem versão estável posterior; não execute `update v1.0.0` esperando um downgrade.

## 11. Provar rollback automático do executável

Somente no agent de homologação. Todas as VPS devem estar saudáveis em v1.0.1 e v1.0.2 precisa estar publicado/assinado. Este teste faz o systemd recusar **apenas** o início da candidata v1.0.2; a versão anterior pode iniciar normalmente. As apps existentes continuam sob Docker/Caddy.

No agent, como root:

```bash
install -d -m 0755 /usr/local/libexec /etc/systemd/system/nelcota-agent.service.d
sha256sum /usr/local/bin/nelcota-agent > /root/nelcota-hml/before-failed-update.sha256
cat > /usr/local/libexec/nelcota-hml-start-check <<'SH'
#!/bin/sh
set -eu
version=$(/usr/local/bin/nelcota-agent version | /usr/bin/jq -er .version)
test "$version" != v1.0.2
SH
chmod 0755 /usr/local/libexec/nelcota-hml-start-check
cat > /etc/systemd/system/nelcota-agent.service.d/homologacao.conf <<'UNIT'
[Service]
ExecStartPre=/usr/local/libexec/nelcota-hml-start-check
UNIT
systemctl daemon-reload
```

No painel, solicite `runuser -u nelcota -- nelcota-panel update v1.0.2`. Monitore o tráfego da app durante a tentativa. Depois da falha, no agent:

```bash
nelcota-agent version
sha256sum -c /root/nelcota-hml/before-failed-update.sha256
cat /var/lib/nelcota-agent/update/result.json
systemctl is-active nelcota-agent
journalctl -u nelcota-agent-update.service -u nelcota-agent -n 100 --no-pager
# Limpe somente a injeção criada neste roteiro.
rm /etc/systemd/system/nelcota-agent.service.d/homologacao.conf
rm /usr/local/libexec/nelcota-hml-start-check
systemctl daemon-reload
systemctl reset-failed nelcota-agent.service nelcota-agent-update.service
```

Na estação, confira o lote e os servers. **Aprovar:** hash/versão do agent voltam a v1.0.1, helper informa `rolled_back`, agent está `online/ready`, app continua respondendo, job do agent fica `failed` e a etapa do painel é `cancelled`; painel continua em v1.0.1. O unit de update pode estar failed porque a tentativa falhou; isso não equivale a falha do serviço recuperado. A cópia `.previous` pode ter sido consumida pelo rollback.

Não deixe a injeção instalada. Depois de removê-la, uma nova solicitação de v1.0.2 deve poder concluir. Se quiser executar o rollback manual abaixo, mantenha a janela congelada e as cópias anteriores disponíveis.

## 12. Rollback manual de desastre

Use quando o helper não conseguiu recuperar, ou quando for necessário restaurar um backup anterior compatível. O rollback automático cobre o executável; **não desfaz migração SQLite, estado do agent ou dados das apps**. Não troque só o binário antigo contra schema novo. No laboratório com releases do mesmo commit, os formatos são iguais; num release real, siga a política de migração e restaure o estado coordenado necessário.

Com deploys/pushes suspensos e sem builds ativos, execute em cada VPS como root:

No **agent**, pare caminhos/helpers e o daemon; preserve Docker, BuildKit e Caddy:

```bash
systemctl stop nelcota-agent-update.path nelcota-agent-update.service nelcota-agent
rm -f /var/lib/nelcota-agent/admin-update.json /var/lib/nelcota-agent/update/request.json
install -m 0755 /root/nelcota-hml/nelcota-agent.before /usr/local/bin/.nelcota-agent.rollback
mv /usr/local/bin/.nelcota-agent.rollback /usr/local/bin/nelcota-agent
OLD_AGENT=$(jq -er .version /root/nelcota-hml/agent-before.json)
install -d -m 0700 /var/lib/nelcota-updater/agent
printf '%s\n' "$OLD_AGENT" > /var/lib/nelcota-updater/agent/version
chmod 0600 /var/lib/nelcota-updater/agent/version
```

No **painel**, restaure executável e backup do instante anterior ao update:

```bash
systemctl stop nelcota-panel-update.path nelcota-panel-update.service nelcota-panel
rm -f /var/lib/nelcota/admin-update.json /var/lib/nelcota/update/request.json
install -m 0755 /root/nelcota-hml/nelcota-panel.before /usr/local/bin/.nelcota-panel.rollback
mv /usr/local/bin/.nelcota-panel.rollback /usr/local/bin/nelcota-panel
PRE_UPDATE_BACKUP=$(cat /root/nelcota-hml/pre-update-backup.path)
nelcota-panel restore "$PRE_UPDATE_BACKUP" --key-file /etc/nelcota/backup.key --replace
OLD_PANEL=$(jq -er .version /root/nelcota-hml/panel-before.json)
install -d -m 0700 /var/lib/nelcota-updater/panel
printf '%s\n' "$OLD_PANEL" > /var/lib/nelcota-updater/panel/version
chmod 0600 /var/lib/nelcota-updater/panel/version
systemctl reset-failed nelcota-panel.service nelcota-panel-update.service
systemctl start nelcota-panel
curl --fail http://127.0.0.1:8080/healthz
```

Só depois, no agent:

```bash
# Restaure o estado/identidade coordenado do agent se o novo release mudou seu formato.
systemctl reset-failed nelcota-agent.service nelcota-agent-update.service
systemctl start nelcota-agent
nelcota-agent version
```

Confirme `online/ready`, login, app e novo deploy. Depois de revisar que não há rollout antigo pendente no banco restaurado, reative `nelcota-panel-update.path` no painel e `nelcota-agent-update.path` no agent. Se houver jobs queued/waiting, cancele-os pela API interativa quando permitido ou siga recuperação específica; não religue os watchers às cegas. Não apague o banco nem o marcador de restore para contornar falha.

Esta alteração manual do estado do updater é uma recuperação administrativa root deliberada, vinculada à cópia anterior verificada. Não faz parte da API normal de update.

## 13. Segurança, persistência e medição final

Na estação, sem bearer:

```bash
curl --silent --output /dev/null --write-out '%{http_code}\n' "$PANEL_URL/api/apps"  # 401
for path in /debug/pprof/ /metrics; do
  curl --silent --output /dev/null --write-out '%{http_code}\n' "$PANEL_URL$path"  # 404
done
curl --silent --output /dev/null --write-out '%{http_code}\n' --request POST \
  --header "Origin: $PANEL_URL" --header 'Content-Type: application/json' \
  --data '{}' "$PANEL_URL/api/dev/session"  # 404
# Se nmap estiver disponível na estação externa:
nmap -Pn -p 22,80,443,2019,6060,8080,8443 "$PANEL_IP" "$AGENT_IP"
```

No painel, a chamada privada sem certificado deve falhar antes de obter HTTP válido:

```bash
curl --max-time 5 --cacert /etc/nelcota/ca.pem https://10.77.0.1:8443/internal/certificate/renew
```

Teste CSRF no navegador: um POST autenticado sem `X-CSRF-Token` deve dar 403; a mesma operação por `N.api` deve funcionar. Abra SSE com o bearer, faça login recente no navegador e configure `N.tokenId` com o ID anotado (ele é perdido ao recarregar a página). Revogue-o com `await N.revokeToken()` e confirme fechamento no próximo heartbeat (15 s, mais o timeout de consulta) e 401 numa nova chamada. Feche o EventSource/cliente de teste para ele não reconectar continuamente. Teste recuperação com um código, depois reutilize-o em **outro desafio válido de passkey**: deve ser recusado.

No painel e agent, após reboot e alguns minutos em repouso:

```bash
# Em cada host, escolha a unit correspondente.
UNIT=nelcota-panel
PID=$(systemctl show "$UNIT" -p MainPID --value)
ps -p "$PID" -o pid,rss,%cpu,etime,comm
systemctl show "$UNIT" -p MemoryCurrent -p MemoryMax
systemctl is-active fail2ban unattended-upgrades
```

No agent use `UNIT=nelcota-agent` e confira também `systemctl show nelcota-builds.slice -p MemoryCurrent -p MemoryMax`. Não misture a memória do agent com Docker, builds e apps. Meça sem pprof e registre kernel, CPU/RAM, versões, carga e horários. Metas do projeto: painel em repouso ≤60 MiB RSS, agent ≤25 MiB; demais metas precisam de apps Go/Node e tráfego representativos. A app BusyBox deste roteiro não homologa tempo de deploy Go/Node.

Use `scripts/performance.sh` com PIDs **locais de cada VPS** e medições reais; não passe o PID do agent na VPS do painel. Valores ausentes permanecem pending. Exemplo no checkout disponível no respectivo host:

```bash
scripts/performance.sh --panel-pid "$PID" --output /caminho/privado/painel-performance.json
# No agent, separadamente, com o PID desse host:
scripts/performance.sh --agent-pid "$PID" --output /caminho/privado/agent-performance.json
```

Os comandos de performance pressupõem que você esteja no checkout **NelcotaDeploy**, e não no repositório da app de teste. Crie o diretório privado de saída antes de executá-los.

Diagnóstico opcional: painel aceita `NELCOTA_PPROF_LISTEN=10.77.0.1:6060` no ambiente e reinício; no agent, use `--pprof-listen 10.77.0.2:6060` em um override revisado de ExecStart. Mantenha o listener no WireGuard; perfis podem conter informações privadas. Desabilite-o após coletar e repita a medição de repouso.

## Registro de aprovação

| Etapa | Evidência obrigatória | Resultado |
|---|---|---|
| Instalação/reboot | versões, services, DNS/TLS, SSH, firewall IPv4/IPv6 e WG | pendente |
| Autenticação | passkey real, TOTP/recovery, CSRF, bearer revogado e SSE encerrado | pendente |
| Deploy | SHA exato, hardening, ausência de portas e segredos mascarados | pendente |
| Troca e falha | tráfego sem erros, candidata recusada mantendo versão anterior | pendente |
| Rollback da app | novo deploy do SHA antigo e resposta esperada | pendente |
| GitHub | push/check run e delivery duplicada idempotente | pendente |
| Backup | arquivo local/offsite, chave separada, hash e S3 recuperável quando usado | pendente |
| Restore | recusa online/corrompido/chave errada, login, peers, novo deploy e novo backup | pendente |
| Update | espera build, agents antes do painel, jobs/helper applied, versão e ready | pendente |
| Rollback backend | hash anterior, helper rolled_back, fila interrompida e recuperação manual ensaiada | pendente |
| Performance | medições reais e metas Go/Node, sem preencher valores fictícios | pendente |

Guarde versões/commit, duração, resultados e logs sanitizados fora do repositório. Não anexe convites, cookies, tokens, sentinelas/credenciais, chaves, join.json, dumps ou perfis brutos. Remova o bearer de homologação e arquivos temporários secretos depois de garantir a guarda das cópias de recuperação. Só promova a instalação quando os itens necessários ao uso estiverem aprovados; DR numa VPS substituta e dados/volumes das aplicações precisam de sua própria evidência.
