# VPS installation and backend acceptance testing

Checked against the code on October 15, 2026. The VPS commands below **were not executed during that local validation**. Mark acceptance criteria only after a real test.

Automated installation uses **two VPS instances**, one panel and one deployment agent. Both installers manage Caddy and wg0 and reject existing configurations; combining roles requires a separate manual procedure.

Start with disposable Debian 12 or Ubuntu 22.04 machines with systemd and cgroups. Installers change firewall and SSH configuration. Test a second SSH key session and recovery-console access first. SSH must use port **22**; review/adapt installer rules before using another port. Do not use hosts with existing Caddy/WireGuard installations.

Follow the numbered stages in order: preparation, panel installation, authentication, agent enrollment, deployments, application rollback, GitHub, backups, restore, signed updates, executable rollback, disaster recovery, and final acceptance.

## 1. Prepare names, networking, and artifacts

On the operator workstation, use Bash, Git, curl, jq, Python 3, and SSH:

```bash
PANEL_DOMAIN=panel.example.com
APP_DOMAIN=staging.example.com
PANEL_IP=203.0.113.10
AGENT_IP=203.0.113.20
PANEL_SSH="root@$PANEL_IP"
AGENT_SSH="root@$AGENT_IP"
PANEL_URL="https://$PANEL_DOMAIN"
APP_URL="https://$APP_DOMAIN"
RELEASE_BASE=https://releases.example.com/nelcota
INITIAL_VERSION=v1.0.0
NEXT_VERSION=v1.0.1
ROLLBACK_TEST_VERSION=v1.0.2
ADMIN_EMAIL=admin@example.com
REPOSITORY=https://github.com/YOUR_USERNAME/nelcota-staging
umask 077
STAGING_DIR=$(mktemp -d "$HOME/nelcota-staging.XXXXXX")
```

The IPs/domains above are examples. Set real values. No official production domain, signing identity, or binary release has been published. The three versions form a laboratory update sequence; existing installations need newer stable versions.

- DNS A: PANEL_DOMAIN to the panel, APP_DOMAIN to the agent. Use direct DNS for this first test. Publish AAAA only after IPv6 is configured and tested.
- Panel: TCP 22/80/443 and UDP 443/51820. Provider firewalls may restrict SSH to the operator and UDP 51820 to the agent.
- Agent: TCP 22/80/443 and UDP 443. Agent WireGuard initiates outbound connections; no public control listener is required.
- 8080/2019 stay on loopback; panel RPC 8443 binds only to 10.77.0.1. Do not expose 6060/8080/8443/2019 publicly.
- Check that 10.77.0.0/24 does not conflict with existing networks. Synchronize clocks with timedatectl status.
- Reserve disk for BuildKit, images, and backup/restore temporary files. The build slice has a 2 GiB memory ceiling in addition to system, Docker, and app needs. Panel/agent process limits do not describe total VPS memory.

Check SSH and DNS:

```bash
ssh "$PANEL_SSH" 'id; cat /etc/os-release; timedatectl status'
ssh "$AGENT_SSH" 'id; cat /etc/os-release; timedatectl status'
getent ahosts "$PANEL_DOMAIN"
getent ahosts "$APP_DOMAIN"
```

### Prepare signed releases on the build workstation

Use the go.mod toolchain (Go 1.26.9), Make, protoc, ShellCheck, Minisign, and verified amd64/arm64 BuildKit binaries. Review [BuildKit v0.34.0 provenance](https://github.com/moby/buildkit/releases/tag/v0.34.0), record digests, and analyze vulnerabilities. A Nelcota signature does not replace upstream-origin verification. See [Minisign documentation](https://jedisct1.github.io/minisign/).

From the project checkout:

```bash
go version
make tools
export PATH="$PWD/.tools:$(go env GOPATH)/bin:$PATH"
make build test lint check-generated
install -d -m 0700 "$HOME/.config/nelcota-release"
SIGNING_SECRET="$HOME/.config/nelcota-release/minisign.key"
SIGNING_PUBLIC="$HOME/.config/nelcota-release/minisign.pub"
# Generate only once. Keep the private key and password outside the VPS instances.
minisign -G -p "$SIGNING_PUBLIC" -s "$SIGNING_SECRET"
SIGNING_KEY=$(sed -n '2p' "$SIGNING_PUBLIC")
# Identified local recipe with Go 1.26.9, x/net 0.61.0, and go-archive 0.3.0.
# Requires govulncheck on PATH; install with:
go install golang.org/x/vuln/cmd/govulncheck@v1.9.0
BUILDKIT_LOCAL="$PWD/.local/buildkit-staging"
bash scripts/buildkit-staging.sh "$BUILDKIT_LOCAL"
BUILDKIT_AMD64="$BUILDKIT_LOCAL/amd64/buildkitd"
BUILDKIT_ARM64="$BUILDKIT_LOCAL/arm64/buildkitd"
STAGING_RELEASE_DIR="$HOME/nelcota-releases-staging"
install -d -m 0700 "$STAGING_RELEASE_DIR"
for version in v1.0.0 v1.0.1 v1.0.2; do
  test ! -e "$STAGING_RELEASE_DIR/$version" || exit 1
  bash scripts/release.sh "$version" "$SIGNING_SECRET" "$BUILDKIT_AMD64" "$BUILDKIT_ARM64" "$BUILDKIT_LOCAL"
  install -d -m 0755 "$STAGING_RELEASE_DIR/$version"
  install -m 0644 "dist/$version/"* "$STAGING_RELEASE_DIR/$version/"
  minisign -Vm "$STAGING_RELEASE_DIR/$version/checksums.txt" -P "$SIGNING_KEY"
done
```

Versions may share a source commit in this laboratory to test executable replacement and embedded versions. Real releases also require migration, protocol, and state compatibility review.

The script requires a clean checkout, creates dist/VERSION, and refuses overwrite. Signed build-info.json records commit/toolchain/BuildKit hashes; buildkit-build-info.txt records daemon modules/toolchains. Official v0.34.0 binaries predate the October Go fixes. The prepared packages use the corrected rebuild described in [staging releases](staging-releases.md).

Publish **every** file from each version directory at RELEASE_BASE/v1.0.0, /v1.0.1, and /v1.0.2, preserving names/content. Updater downloads require direct HTTPS without redirects. Never overwrite published versions. Example for an already configured HTTPS distribution host with directory write permission:

```bash
RELEASE_SSH=publisher@release-host
ssh "$RELEASE_SSH" 'set -eu
for v in v1.0.0 v1.0.1 v1.0.2; do
  test ! -e "/var/www/nelcota-releases/$v"
  install -d -m 0755 "/var/www/nelcota-releases/$v"
done'
for version in v1.0.0 v1.0.1 v1.0.2; do
  scp "$STAGING_RELEASE_DIR/$version/"* "$RELEASE_SSH:/var/www/nelcota-releases/$version/"
done
curl --fail --silent --show-error --proto '=https' \
  "$RELEASE_BASE/$INITIAL_VERSION/checksums.txt" -o "$STAGING_DIR/checksums.txt"
curl --fail --silent --show-error --proto '=https' \
  "$RELEASE_BASE/$INITIAL_VERSION/checksums.txt.minisig" -o "$STAGING_DIR/checksums.txt.minisig"
minisign -Vm "$STAGING_DIR/checksums.txt" -P "$SIGNING_KEY"
```

Distribute the public key through a trusted channel; do not trust only a key obtained beside the download being verified.

**Accept this stage:** checked DNS/networking, tested SSH keys, accessible correctly signed releases, and no private signing key on either VPS.

## 2. Install the panel

Upload scripts from the reviewed checkout:

```bash
scp scripts/install.sh "$PANEL_SSH:/root/nelcota-install.sh"
scp scripts/agent.sh "$AGENT_SSH:/root/nelcota-agent-install.sh"
ssh "$PANEL_SSH"
```

On the panel, as root, set the public stage-1 variables again:

```bash
PANEL_DOMAIN=panel.example.com
PANEL_IP=203.0.113.10
ADMIN_EMAIL=admin@example.com
RELEASE_BASE=https://releases.example.com/nelcota
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

The initial invitation is in /etc/nelcota/first-access.json and lasts 15 minutes. Copy it to a private workstation file without printing its token:

```bash
ssh "$PANEL_SSH" 'cat /etc/nelcota/first-access.json' > "$STAGING_DIR/first-access.json"
chmod 0600 "$STAGING_DIR/first-access.json"
curl --fail --silent --show-error "$PANEL_URL/healthz"
```

**Accept:** version v1.0.0, active services, valid HTTPS without -k, internal HTTP on loopback, and RPC at 10.77.0.1:8443. Register the passkey immediately. If the first invitation expires, restart from an empty installation/initial snapshot; init does not renew invitations.

## 3. First access, TOTP, and staging token

The web page is still a placeholder. Open **the panel HTTPS origin** in a passkey-capable browser and paste the reviewed [`scripts/staging/browser.js`](../scripts/staging/browser.js) into its console. It calls same-origin APIs and needs no external frontend.

Execute in order:

```javascript
await N.register();       // Paste the private-file token into the dialog without console.log.
await N.login();          // Passkey with user verification.
await N.enableTOTP();     // Register otpauth in the authenticator and enter the code.
await N.login();          // Enabling TOTP revokes previous sessions and tokens.
await N.recoveryCodes();  // Store the codes in a vault; they are shown once.
await N.makeToken();      // Copy the dialog token into the hidden prompt below.
N.tokenId;                // Record this non-secret ID to revoke the same token afterward.
```

The helper keeps CSRF in memory; paste it again after reload. If a revoked HttpOnly cookie causes a CSRF error at login, remove __Host-nelcota through site storage/DevTools and retry. For 429, wait for Retry-After and repeat the ceremony. Never copy cookies/tokens to URLs or public evidence.

Store the bearer on the workstation in a mode 0600 file, excluding it from history and curl arguments:

```bash
read -r -s -p 'Staging token: ' STAGING_TOKEN
printf '\n'
printf 'header = "Authorization: Bearer %s"\n' "$STAGING_TOKEN" > "$STAGING_DIR/auth.curl"
unset STAGING_TOKEN
chmod 0600 "$STAGING_DIR/auth.curl"
api() {
  local path=$1
  shift
  curl --fail-with-body --silent --show-error --config "$STAGING_DIR/auth.curl" \
    --header 'Content-Type: application/json' "$PANEL_URL$path" "$@"
}
api /api/servers | jq .
```

The bearer lasts one hour. On 401, sign in again, issue a new token, and update the file. Backup/update/batch cancellation require a **recent interactive session**, not bearer authentication; use N.api or the local CLI.

**Accept:** real passkey registration/login, enforced TOTP, securely stored recovery codes, and working scoped token. Wait for a new code rather than reusing the TOTP activation code.

## 4. Invite and install the agent

From the workstation, generate the invitation and transfer only its token file:

```bash
api /api/servers/invite --request POST --data-binary \
  '{"name":"deploy-staging","wireguard_ip":"10.77.0.2","build_limit":1,"cache_bytes":5368709120}' \
  > "$STAGING_DIR/invitation.json"
SERVER_ID=$(jq -er .server_id "$STAGING_DIR/invitation.json")
jq -er .token "$STAGING_DIR/invitation.json" > "$STAGING_DIR/join-token"
chmod 0600 "$STAGING_DIR/join-token"
scp "$STAGING_DIR/join-token" "$AGENT_SSH:/root/nelcota-join"
ssh "$AGENT_SSH"
```

On the agent as root, within the 15-minute invitation lifetime:

```bash
PANEL_URL=https://panel.example.com
RELEASE_BASE=https://releases.example.com/nelcota
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

From the workstation:

```bash
api /api/servers > "$STAGING_DIR/servers.json"
jq --arg id "$SERVER_ID" '.[] | select(.id==$id) | {id,status,ready,version,heartbeat_at}' "$STAGING_DIR/servers.json"
```

**Accept:** online, ready=true, v1.0.0, recent heartbeat, and a WireGuard handshake on both hosts. Never print /etc/nelcota-agent/join.json; it contains a private mTLS key. Invitation reuse must fail. Do not rerun the installer over an installed host.

## 5. Create a disposable application and deploy

Create an empty **test repository** on GitHub at REPOSITORY. The first test may use a public repository with installation_id=0. Private repositories, check runs, and webhooks require the stage-7 GitHub App.

Use a new workstation directory:

```bash
mkdir "$STAGING_DIR/app-repo"
cd "$STAGING_DIR/app-repo"
git init -b main
git remote add origin "$REPOSITORY"
mkdir public
printf 'v1\n' > public/index.html
printf 'ok\n' > public/health
cat > start.sh <<'SH'
#!/bin/sh
set -eu
# Artificial value used only to verify log masking.
printf 'staging-runtime-secret=%s\n' "${STAGING_SECRET:-unset}"
exec httpd -f -p 8080 -h /www
SH
cat > Dockerfile <<'DOCKER'
FROM busybox:1.37.0
RUN --mount=type=secret,id=STAGING_BUILD_SECRET cat /run/secrets/STAGING_BUILD_SECRET
COPY --chmod=0555 public/ /www/
COPY --chmod=0555 start.sh /start.sh
USER 65532:65532
EXPOSE 8080
CMD ["/start.sh"]
DOCKER
chmod 0755 start.sh
git add Dockerfile start.sh public
git commit -m 'Add staging application v1'
git push -u origin main
SHA_V1=$(git rev-parse HEAD)
```

The base matches the local integration fixture. This is disposable; review/pin a suitable base before using a real app. Explicit chmod allows UID 65532 reads even with a private checkout umask.

Create the app and two **artificial** sentinel values; never use real credentials:

```bash
jq -n --arg server "$SERVER_ID" --arg repo "$REPOSITORY" --arg domain "$APP_DOMAIN" \
  '{name:"staging-backend",server_id:$server,repository:$repo,branch:"main",config:{domains:[$domain],memory_bytes:134217728,nano_cpus:500000000,port:8080,health_path:"/health",health_timeout:30,replicas:1,cache_enabled:true,dockerfile:"Dockerfile",installation_id:0,stopped:false}}' \
  > "$STAGING_DIR/app-input.json"
api /api/apps --request POST --data-binary "@$STAGING_DIR/app-input.json" > "$STAGING_DIR/app.json"
APP_ID=$(jq -er .id "$STAGING_DIR/app.json")
python3 - "$STAGING_DIR" <<'PY'
import json, pathlib, secrets, sys
p = pathlib.Path(sys.argv[1])
values = [{"key":"STAGING_SECRET","value":secrets.token_hex(24),"build":False},
          {"key":"STAGING_BUILD_SECRET","value":secrets.token_hex(24),"build":True}]
(p/'env.json').write_text(json.dumps(values))
(p/'sentinels.txt').write_text('\n'.join(v['value'] for v in values)+'\n')
PY
api "/api/apps/$APP_ID/env" --request PUT --data-binary "@$STAGING_DIR/env.json"
deploy() {
  jq -n --arg app "$APP_ID" --arg sha "$1" --arg origin "${2:-manual}" \
    '{app_id:$app,sha:$sha,origin:$origin,clean:false}' > "$STAGING_DIR/deploy-input.json"
  api /api/deployments --request POST --data-binary "@$STAGING_DIR/deploy-input.json" > "$STAGING_DIR/deploy.json"
  jq -er .id "$STAGING_DIR/deploy.json"
}
wait_deploy() {
  local id=$1
  for ((attempt=0; attempt<300; attempt++)); do
    api "/api/deployments/$id" > "$STAGING_DIR/deployment-$id.json" || return 1
    case $(jq -r .status "$STAGING_DIR/deployment-$id.json") in
      success) return 0;;
      failed|cancelled) jq '{id,status,error_code,timings}' "$STAGING_DIR/deployment-$id.json"; return 1;;
    esac
    sleep 2
  done
  printf 'Timeout waiting for deployment %s\n' "$id" >&2
  return 1
}
DEPLOY_V1=$(deploy "$SHA_V1")
wait_deploy "$DEPLOY_V1"
curl --fail --silent --show-error "$APP_URL/"
curl --fail --silent --show-error "$APP_URL/health"
api "/api/deployments/$DEPLOY_V1/logs" > "$STAGING_DIR/build-logs.json"
```

Cold builds may take longer because of base downloads/ACME. wait_deploy fails on deployment errors; resolve them before continuing.

Follow events for 20 seconds on the workstation; timeout exit 28 is expected:

```bash
curl --silent --show-error --no-buffer --max-time 20 --config "$STAGING_DIR/auth.curl" \
  --get --data-urlencode "topic=app/$APP_ID" "$PANEL_URL/api/events" \
  > "$STAGING_DIR/runtime.sse"
if grep -qFf "$STAGING_DIR/sentinels.txt" "$STAGING_DIR/build-logs.json" "$STAGING_DIR/runtime.sse"; then
  printf 'FAILURE: unmasked sentinel found\n' >&2
else
  printf 'No cleartext sentinel in captured logs; also check [REDACTED].\n'
fi
```

On the agent, set the non-secret APP_ID and inspect without printing Config.Env:

```bash
APP_ID=ID_COPIADO_DA_ETAPA_ANTERIOR
CID=$(docker ps -q --filter "label=nelcota.app=$APP_ID" | head -n 1)
test -n "$CID"
docker inspect --format '{{.Config.User}} ro={{.HostConfig.ReadonlyRootfs}} caps={{json .HostConfig.CapDrop}} security={{json .HostConfig.SecurityOpt}} ports={{json .HostConfig.PortBindings}} mem={{.HostConfig.Memory}} cpu={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}}' "$CID"
docker port "$CID"
```

Check the **image** environment/history for sentinel leaks; runtime environment values in the container are expected. Transfer only the artificial sentinel values in a private file:

```bash
scp "$STAGING_DIR/sentinels.txt" "$AGENT_SSH:/root/nelcota-staging-sentinels.txt"
```

On the agent, with the preceding CID:

```bash
umask 077
IMAGE_ID=$(docker inspect --format '{{.Image}}' "$CID")
docker image inspect --format '{{json .Config.Env}}' "$IMAGE_ID" > /root/nelcota-staging-image-env.txt
docker history --no-trunc "$IMAGE_ID" > /root/nelcota-staging-image-history.txt
if grep -qFf /root/nelcota-staging-sentinels.txt /root/nelcota-staging-image-env.txt /root/nelcota-staging-image-history.txt; then
  printf 'FAILURE: sentinel found in image environment/history\n' >&2
fi
```

These checks do not replace Dockerfile/layer review. A real app must not copy build secrets into image files.

**Accept:** success deployment, / returns v1, /health returns 200, masked sentinels in captured logs, and no real credentials. Verify UID 65532, read-only rootfs, ALL CapDrop, no-new-privileges, PIDs=128, CPU/memory limits, and no published ports.

## 6. Deploy under traffic, reject unhealthy candidates, and roll back

On the workstation, with api, deploy, and wait_deploy still defined:

```bash
cd "$STAGING_DIR/app-repo"
printf 'v2\n' > public/index.html
git add public/index.html
git commit -m 'Publish application v2'
git push
SHA_V2=$(git rev-parse HEAD)
# Start before triggering deployment. Every response must be v1 or v2 with HTTP 2xx.
(
  for ((i=0; i<600; i++)); do
    if body=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 5 "$APP_URL/" 2>>"$STAGING_DIR/traffic-errors.log"); then
      case "$body" in v1|v2) printf 'OK %s\n' "$body";; *) printf 'BAD_BODY\n';; esac
    else printf 'FAIL\n'; fi
    sleep 0.2
  done
) > "$STAGING_DIR/traffic.log" &
TRAFFIC_PID=$!
DEPLOY_V2=$(deploy "$SHA_V2")
wait_deploy "$DEPLOY_V2"
wait "$TRAFFIC_PID"
if grep -Eq '^(FAIL|BAD_BODY)$' "$STAGING_DIR/traffic.log"; then
  printf 'FAILURE during route switching; inspect traffic.log and traffic-errors.log\n' >&2
fi
curl --fail --silent --show-error "$APP_URL/"
```

Record the v2 container/image IDs for comparison. Test an unhealthy candidate:

```bash
printf 'bad\n' > public/index.html
git rm public/health
git add public/index.html
git commit -m 'Add candidate with an invalid healthcheck'
git push
SHA_BAD=$(git rev-parse HEAD)
DEPLOY_BAD=$(deploy "$SHA_BAD")
if wait_deploy "$DEPLOY_BAD"; then
  printf 'FAILURE: unhealthy candidate was accepted\n' >&2
fi
api "/api/deployments/$DEPLOY_BAD" | jq '{id,status,error_code}'
curl --fail --silent --show-error "$APP_URL/"
```

Expected: the candidate fails, public responses remain v2, candidate containers/images are not left active, and the old route remains. failed is the correct outcome of this negative test.

Application rollback is **a new build of the previous SHA**, not an immediate image switch:

```bash
DEPLOY_ROLLBACK=$(deploy "$SHA_V1" rollback)
wait_deploy "$DEPLOY_ROLLBACK"
curl --fail --silent --show-error "$APP_URL/"
```

**Accept:** no errors during the traffic test, v2 deployed, unhealthy candidate rejected while v2 stays available, and a successful rollback serving v1. Short requests do not prove streaming/long-request behavior; repeat with representative traffic. Current draining is five seconds.

Additional pipeline tests:

- Cancellation: add RUN sleep 60 to the disposable Dockerfile, push a SHA, deploy with clean:true, wait for building, then POST /api/deployments/ID/cancel. Expect cancelled, temporary cleanup, and the previous public version. Restore the Dockerfile afterward.
- Coalescing: occupy the server with a slow build, then queue three SHAs without waiting. The first two queued deployments must become cancelled and only the latest queued SHA should run after the active build. Without blocking, the first may be claimed before the next POST.
- Replicas: POST /api/apps/APP_ID/actions with action=scale and replicas=2, verify two replicas, then scale to one. Test stop with confirmed=true and start.
- Recovery: kill only the disposable app container in the test window and observe a healthy replacement. Restart panel/agent separately, then reboot each VPS one at a time. Recheck SSH, firewall, WireGuard, online/ready, routes, and the app. Never use global Docker prune.

## 7. Real GitHub App and webhooks

After await N.login() for recent authentication:

```javascript
await N.githubManifest();
```

The helper submits a GitHub Manifest form. The callback returns installation_url; open it and install the App **only on the staging repository**. Record the installation ID and apply it to the app:

```bash
INSTALLATION_ID=12345678
jq --argjson installation "$INSTALLATION_ID" '.config.installation_id=$installation' \
  "$STAGING_DIR/app-input.json" > "$STAGING_DIR/app-private.json"
api "/api/apps/$APP_ID" --request PUT --data-binary "@$STAGING_DIR/app-private.json" > "$STAGING_DIR/app.json"
```

Push a healthy fixture revision:

```bash
cd "$STAGING_DIR/app-repo"
git restore --source "$SHA_V2" -- public
git add public
git commit -m 'Restore the healthcheck and validate the webhook'
git push
SHA_PUSH=$(git rev-parse HEAD)
api "/api/apps/$APP_ID/deployments" | jq --arg sha "$SHA_PUSH" '.[] | select(.sha==$sha) | {id,sha,origin,status}'
```

Verify an origin=push deployment finishes successfully and GitHub receives a check run for the exact SHA. Redeliver the same webhook and confirm no duplicate deployment. Invalid HMAC must fail; never disable signature checks to pass. Keep the app on a healthy commit before maintenance tests.

## 8. Back up and store the key outside the VPS

On the panel as root:

```bash
install -d -m 0700 -o nelcota -g nelcota /var/lib/nelcota/backups
BACKUP="/var/lib/nelcota/backups/staging-$(date -u +%Y%m%dT%H%M%SZ).nbk"
runuser -u nelcota -- /usr/local/bin/nelcota-panel backup \
  --output "$BACKUP" --key-file /etc/nelcota/backup.key
stat -c '%a %U:%G %s %n' "$BACKUP"
sha256sum "$BACKUP"
# Must fail: restore requires the panel to be stopped. Record the exit code.
if /usr/local/bin/nelcota-panel restore "$BACKUP" --key-file /etc/nelcota/backup.key --replace; then
  printf 'FAILURE: restore accepted a running panel\n' >&2
else
  printf 'Restore with a running panel rejected as expected.\n'
fi
```

On the workstation, specify the exact backup path. Store backup and key separately:

```bash
BACKUP_REMOTE=/var/lib/nelcota/backups/staging-UTC_TIMESTAMP.nbk
scp "$PANEL_SSH:$BACKUP_REMOTE" "$STAGING_DIR/panel.nbk"
STAGING_KEY_DIR=$(mktemp -d "$HOME/nelcota-keys.XXXXXX")
ssh "$PANEL_SSH" 'cat /etc/nelcota/backup.key' > "$STAGING_KEY_DIR/backup.key"
chmod 0600 "$STAGING_KEY_DIR/backup.key"
sha256sum "$STAGING_DIR/panel.nbk"
```

Move the key to a vault/offline storage, not the backup bucket. Compare downloaded SHA-256 with the panel copy. The key is 32 raw bytes; do not print or edit it as text.

For API backup-job acceptance, sign in recently through the browser:

```javascript
await N.login();
var backupJob = await N.api('/api/operations/backup', 'POST', {});
console.table((await N.api('/api/operations')).filter(j => j.id === backupJob.id));
```

Poll until applied; queued/waiting do not mean complete. Manual files are /var/lib/nelcota/backups/manual-ID.nbk. Daily files use nelcota-YYYY-MM-DD.nbk, seven-day local retention, and .ok after successful optional upload. Manual backups are not subject to that retention.

### Optional S3 upload

On the panel, first create the private file only if absent, then edit it locally. Keep credentials out of commands and evidence:

```bash
umask 077
test ! -e /etc/nelcota/backup-s3.json || exit 1
install -o nelcota -g nelcota -m 0600 /dev/null /etc/nelcota/backup-s3.json
```

Format of /etc/nelcota/backup-s3.json:

```json
{"endpoint":"https://YOUR_ENDPOINT","region":"YOUR_REGION","bucket":"YOUR_BUCKET","prefix":"staging","access_key":"YOUR_ACCESS_KEY","secret_key":"YOUR_SECRET_KEY"}
```



```bash
chown nelcota:nelcota /etc/nelcota/backup-s3.json
chmod 0600 /etc/nelcota/backup-s3.json
# Only if no definition exists; edit existing definitions instead.
! grep -q '^NELCOTA_BACKUP_S3_CONFIG=' /etc/nelcota/panel.env || exit 1
printf '%s\n' 'NELCOTA_BACKUP_S3_CONFIG=/etc/nelcota/backup-s3.json' >> /etc/nelcota/panel.env
systemctl restart nelcota-panel
runuser -u nelcota -- /usr/local/bin/nelcota-panel backup \
  --output "/var/lib/nelcota/backups/s3-staging-$(date -u +%Y%m%dT%H%M%SZ).nbk" \
  --key-file /etc/nelcota/backup.key --s3-config /etc/nelcota/backup-s3.json
```

Download the object with your storage's administrative client, compare SHA-256, and restore that copy. Temporarily test invalid credentials: the upload/job must fail without leaking credentials and retain the local archive for retry. Correct configuration before continuing. The daily worker retries hourly; CLI --s3-config makes an independent attempt.

**Accept:** completed online snapshot, active-panel restore rejection, off-VPS backup/key storage, matching hashes, and recoverable remote object when configured. .nbk covers panel database/configuration, not Docker images, app volumes/data, the OS, units, Caddy, or agent state/identity. Back those up separately as needed.

## 9. Restore and prove recovery

First use the same staging VPS pair, the **same executable version** that made the backup, no pending rollout, and no active builds. Use a CLI backup from that stable state. The agent's published app should continue responding while the panel is stopped.

Choose a backup containing S3 configuration if enabled. After that backup, add an artificial marker from the workstation to prove the snapshot was restored:

```bash
api "/api/apps/$APP_ID/env" --request PUT --data-binary \
  '[{"key":"STAGING_AFTER_BACKUP","value":"only-after-the-snapshot","build":false}]'
api "/api/apps/$APP_ID/env" | jq -e 'any(.[]; .key=="STAGING_AFTER_BACKUP")'
```

On the panel as root:

```bash
BACKUP=/var/lib/nelcota/backups/staging-UTC_TIMESTAMP.nbk
systemctl stop nelcota-panel-update.path nelcota-panel-update.service
systemctl stop nelcota-panel
nelcota-panel restore "$BACKUP" --key-file /etc/nelcota/backup.key --replace
stat -c '%a %U:%G %n' /var/lib/nelcota/panel.db /etc/nelcota/master.key
# Do not remove the marker to force startup; repeat restore if it exists.
test ! -e /var/lib/nelcota/restore-in-progress
systemctl start nelcota-panel
systemctl start nelcota-panel-update.path
curl --fail http://127.0.0.1:8080/healthz
journalctl -u nelcota-panel -n 80 --no-pager
runuser -u nelcota -- /usr/local/bin/nelcota-panel backup \
  --output "/var/lib/nelcota/backups/after-restore-$(date -u +%Y%m%dT%H%M%SZ).nbk" \
  --key-file /etc/nelcota/backup.key
```

Sign in again from the workstation. Refresh any bearer created after the snapshot. Verify apps, configured environment-key presence without reading secrets, deployments, audit, and online/ready. Deploy a healthy revision to verify the master key, certificates, and transport. Check the S3 copy and subsequent backup. Remove .before-restore copies only after accepting recovery.

```bash
api "/api/apps/$APP_ID/env" | jq -e 'all(.[]; .key!="STAGING_AFTER_BACKUP")'
```

The marker must disappear; STAGING_SECRET and STAGING_BUILD_SECRET must remain configured.

Negative tests in an isolated directory: restore a truncated archive and one with the wrong key. Neither may create panel.db in the destination:

```bash
umask 077
TEST_ROOT=$(mktemp -d /root/nelcota-restore-negativo.XXXXXX)
cp "$BACKUP" "$TEST_ROOT/truncado.nbk"
truncate -s -20 "$TEST_ROOT/truncado.nbk"
if nelcota-panel restore "$TEST_ROOT/truncado.nbk" --data-dir "$TEST_ROOT/data" \
    --config-dir "$TEST_ROOT/config" --key-file /etc/nelcota/backup.key; then
  printf 'FAILURE: truncated backup accepted\n' >&2
fi
test ! -e "$TEST_ROOT/data/panel.db"
nelcota-panel backup-keygen --output "$TEST_ROOT/wrong-key.key"
if nelcota-panel restore "$BACKUP" --data-dir "$TEST_ROOT/wrong-data" \
    --config-dir "$TEST_ROOT/wrong-config" --key-file "$TEST_ROOT/wrong-key.key"; then
  printf 'FAILURE: incorrect key accepted\n' >&2
fi
test ! -e "$TEST_ROOT/wrong-data/panel.db"
```

### Recover the panel on a replacement VPS

Keep the old VPS off to avoid duplicate panel identities. Install reviewed services/executables on the replacement, stop panel/updater, and restore with the separate key and --replace. Set restored directory ownership to nelcota:nelcota. Preserve the original domain/origin for passkeys and update DNS/public addresses.

```bash
chown -R nelcota:nelcota /etc/nelcota /var/lib/nelcota
```

The .nbk does not contain complete host configuration. Restore/review units, release trust, Caddy, firewall, and environment. The installer creates a new WireGuard identity; after restoring the previous protected configuration, apply its correct key:

```bash
systemctl stop nelcota-panel
wg set wg0 private-key /etc/nelcota/wg.key
wg show wg0 public-key
cat /etc/nelcota/wg.pub
# The two public keys above must match.
systemctl start nelcota-panel
# The panel restores registered peers on startup.
wg-quick save wg0
```

Agents must still reach the panel. Adjust DNS/endpoints deliberately after IP changes; changing the domain needs a separate passkey-migration plan. Agent certificates/fingerprints must match the snapshot; later rotation can block reconnection. Keep coordinated backups of /etc/nelcota-agent, /var/lib/nelcota-agent, and agent WireGuard configuration. Never delete certificates or disable pinning to bypass identity mismatch. Test identity recovery before declaring complete disaster recovery.

**Accept:** login and usable secrets, restored peers, accessible app, successful new deployment/backup, and invalid archives rejected before database installation.

## 10. Signed update and active-build waiting

Wait for an empty queue and preserve rollback copies independently of .previous. On the panel as root:

```bash
install -d -m 0700 /root/nelcota-staging
nelcota-panel version > /root/nelcota-staging/panel-before.json
install -m 0755 /usr/local/bin/nelcota-panel /root/nelcota-staging/nelcota-panel.before
PRE_UPDATE_BACKUP="/var/lib/nelcota/backups/pre-staging-update-$(date -u +%Y%m%dT%H%M%SZ).nbk"
runuser -u nelcota -- /usr/local/bin/nelcota-panel backup \
  --output "$PRE_UPDATE_BACKUP" --key-file /etc/nelcota/backup.key
printf '%s\n' "$PRE_UPDATE_BACKUP" > /root/nelcota-staging/pre-update-backup.path
```

On the agent as root:

```bash
install -d -m 0700 /root/nelcota-staging
nelcota-agent version > /root/nelcota-staging/agent-before.json
install -m 0755 /usr/local/bin/nelcota-agent /root/nelcota-staging/nelcota-agent.before
sha256sum /usr/local/bin/nelcota-agent > /root/nelcota-staging/agent-before.sha256
```

Store these copies and the backup off-VPS too. Freeze pushes/deploys for the rollback window; database restore returns to that point.

Start a controlled slow app build and confirm building. Then request the rollout **on the panel**:

```bash
runuser -u nelcota -- /usr/local/bin/nelcota-panel update v1.0.1
```

Browser alternative after recent login: use **only one alternative**, because an existing pending update rejects duplication:

```javascript
await N.login();
var rollout = await N.api('/api/operations/update', 'POST', {version: 'v1.0.1'});
console.table(rollout);
```

The CLI only queues requests; exit 0 does not mean installed. Monitor from the workstation:

```bash
api /api/operations | jq '.[] | {id,batch,target,version,status,error_code}'
```

On each VPS:

```bash
# Panel
journalctl -u nelcota-panel-update.service -u nelcota-panel -n 100 --no-pager
cat /var/lib/nelcota/update/result.json
nelcota-panel version
# Agent (separate VPS)
journalctl -u nelcota-agent-update.service -u nelcota-agent -n 100 --no-pager
cat /var/lib/nelcota-agent/update/result.json
nelcota-agent version
```

**Accept:** no agent restart during its active build; new target builds wait. Agents become ready on the new version before the panel updates. Every batch job and helper result reaches applied, a panel pre-update backup exists, the app remains reachable, and a new deploy succeeds. Offline servers hold the queue; queued/waiting is not acceptance. Allow up to ten minutes for helpers and twelve for coordination; inspect logs on timeout.

The updater does not update Docker, Caddy, or BuildKit. It requires newer stable versions; update v1.0.0 is not a downgrade command.

## 11. Prove automatic executable rollback

Only on the staging agent. All VPS instances must be healthy on v1.0.1 and v1.0.2 must be signed and published. The test makes systemd reject **only** candidate v1.0.2 startup; the previous version can start normally. Existing applications remain under Docker/Caddy.

On the agent as root:

```bash
install -d -m 0755 /usr/local/libexec /etc/systemd/system/nelcota-agent.service.d
sha256sum /usr/local/bin/nelcota-agent > /root/nelcota-staging/before-failed-update.sha256
cat > /usr/local/libexec/nelcota-staging-start-check <<'SH'
#!/bin/sh
set -eu
version=$(/usr/local/bin/nelcota-agent version | /usr/bin/jq -er .version)
test "$version" != v1.0.2
SH
chmod 0755 /usr/local/libexec/nelcota-staging-start-check
cat > /etc/systemd/system/nelcota-agent.service.d/staging.conf <<'UNIT'
[Service]
ExecStartPre=/usr/local/libexec/nelcota-staging-start-check
UNIT
systemctl daemon-reload
```

On the panel, request runuser -u nelcota -- nelcota-panel update v1.0.2. Monitor application traffic. After failure, on the agent:

```bash
nelcota-agent version
sha256sum -c /root/nelcota-staging/before-failed-update.sha256
cat /var/lib/nelcota-agent/update/result.json
systemctl is-active nelcota-agent
journalctl -u nelcota-agent-update.service -u nelcota-agent -n 100 --no-pager
# Remove only the failure injection created by this guide.
rm /etc/systemd/system/nelcota-agent.service.d/staging.conf
rm /usr/local/libexec/nelcota-staging-start-check
systemctl daemon-reload
systemctl reset-failed nelcota-agent.service nelcota-agent-update.service
```

Check the batch and servers from the workstation. **Accept:** agent hash/version returns to v1.0.1, helper reports rolled_back, agent is online/ready, the app responds, the agent job fails, the panel stage is cancelled, and the panel remains v1.0.1. The update unit may be failed because the attempt failed; that does not mean the recovered daemon failed. Rollback may consume .previous.

Remove the injected failure. A fresh v1.0.2 request must then succeed. Keep deployments frozen and previous copies available if continuing to manual rollback.

## 12. Manual disaster rollback

Use if automatic recovery fails or an earlier compatible backup must be restored. Executable rollback **does not reverse SQLite migrations, agent state, or application data**. Never combine an old executable with an incompatible new schema. Laboratory releases from one commit share formats; real releases require coordinated migration/state recovery.

With pushes/deployments suspended and no builds active, work as root on each VPS.

On the **agent**, stop watchers/helpers and the daemon, preserving Docker, BuildKit, and Caddy:

```bash
systemctl stop nelcota-agent-update.path nelcota-agent-update.service nelcota-agent
rm -f /var/lib/nelcota-agent/admin-update.json /var/lib/nelcota-agent/update/request.json
install -m 0755 /root/nelcota-staging/nelcota-agent.before /usr/local/bin/.nelcota-agent.rollback
mv /usr/local/bin/.nelcota-agent.rollback /usr/local/bin/nelcota-agent
OLD_AGENT=$(jq -er .version /root/nelcota-staging/agent-before.json)
install -d -m 0700 /var/lib/nelcota-updater/agent
printf '%s\n' "$OLD_AGENT" > /var/lib/nelcota-updater/agent/version
chmod 0600 /var/lib/nelcota-updater/agent/version
```

On the **panel**, restore the executable and backup taken immediately before the update:

```bash
systemctl stop nelcota-panel-update.path nelcota-panel-update.service nelcota-panel
rm -f /var/lib/nelcota/admin-update.json /var/lib/nelcota/update/request.json
install -m 0755 /root/nelcota-staging/nelcota-panel.before /usr/local/bin/.nelcota-panel.rollback
mv /usr/local/bin/.nelcota-panel.rollback /usr/local/bin/nelcota-panel
PRE_UPDATE_BACKUP=$(cat /root/nelcota-staging/pre-update-backup.path)
nelcota-panel restore "$PRE_UPDATE_BACKUP" --key-file /etc/nelcota/backup.key --replace
OLD_PANEL=$(jq -er .version /root/nelcota-staging/panel-before.json)
install -d -m 0700 /var/lib/nelcota-updater/panel
printf '%s\n' "$OLD_PANEL" > /var/lib/nelcota-updater/panel/version
chmod 0600 /var/lib/nelcota-updater/panel/version
systemctl reset-failed nelcota-panel.service nelcota-panel-update.service
systemctl start nelcota-panel
curl --fail http://127.0.0.1:8080/healthz
```

Only afterward, on the agent:

```bash
# Restore coordinated agent state/identity if the new release changed its format.
systemctl reset-failed nelcota-agent.service nelcota-agent-update.service
systemctl start nelcota-agent
nelcota-agent version
```

Confirm online/ready, login, app availability, and a new deployment. Review the restored database for pending rollout jobs before re-enabling panel/agent update.path watchers. Cancel queued/waiting jobs through the interactive API when possible, or follow dedicated recovery. Do not blindly restart watchers, delete the database, or remove restore markers to bypass errors.

Manual updater-state changes here are deliberate root disaster recovery tied to a verified previous executable, not a normal update API operation.

## 13. Security, persistence, and final measurements

From the workstation without bearer authentication:

```bash
curl --silent --output /dev/null --write-out '%{http_code}\n' "$PANEL_URL/api/apps"  # 401
for path in /debug/pprof/ /metrics; do
  curl --silent --output /dev/null --write-out '%{http_code}\n' "$PANEL_URL$path"  # 404
done
curl --silent --output /dev/null --write-out '%{http_code}\n' --request POST \
  --header "Origin: $PANEL_URL" --header 'Content-Type: application/json' \
  --data '{}' "$PANEL_URL/api/dev/session"  # 404
# If nmap is available on the external workstation:
nmap -Pn -p 22,80,443,2019,6060,8080,8443 "$PANEL_IP" "$AGENT_IP"
```

On the panel, an RPC request without a client certificate must fail before a valid HTTP response:

```bash
curl --max-time 5 --cacert /etc/nelcota/ca.pem https://10.77.0.1:8443/internal/certificate/renew
```

Test CSRF in the browser: authenticated POST without X-CSRF-Token returns 403, while the same operation through N.api succeeds. Open SSE using the bearer, sign in again, and set the recorded N.tokenId if the page was reloaded. Revoke with await N.revokeToken(); expect stream closure at the next heartbeat (15 seconds plus query timeout) and 401 on a new request. Close test EventSource/clients to avoid reconnection loops. Use a recovery code, then attempt reuse with **another valid passkey challenge**; reuse must fail.

On panel and agent after reboot and several idle minutes:

```bash
# Choose the appropriate unit on each host.
UNIT=nelcota-panel
PID=$(systemctl show "$UNIT" -p MainPID --value)
ps -p "$PID" -o pid,rss,%cpu,etime,comm
systemctl show "$UNIT" -p MemoryCurrent -p MemoryMax
systemctl is-active fail2ban unattended-upgrades
```

Use UNIT=nelcota-agent on the agent and inspect nelcota-builds.slice MemoryCurrent/MemoryMax separately. Do not mix agent memory with Docker/builds/apps. Measure without pprof; record kernel, hardware, versions, load, and time. Targets: panel idle RSS ≤60 MiB, agent ≤25 MiB. Other targets require representative Go/Node apps and traffic; this BusyBox fixture does not establish those deployment times.

Run scripts/performance.sh using PIDs **local to each VPS**, never the agent PID on the panel host. Missing values remain pending. From the project checkout on the corresponding host:

```bash
scripts/performance.sh --panel-pid "$PID" --output /private/path/panel-performance.json
# On the agent separately, with that host PID:
scripts/performance.sh --agent-pid "$PID" --output /private/path/agent-performance.json
```

Performance commands assume the **NelcotaDeploy** checkout, not the disposable application repository. Create a private output directory first.

Optional diagnostics: set panel NELCOTA_PPROF_LISTEN=10.77.0.1:6060 and restart; use --pprof-listen 10.77.0.2:6060 through a reviewed agent ExecStart override. Bind only to WireGuard; profiles may contain private data. Disable diagnostics afterward and repeat idle measurements.

## Acceptance record

| Stage | Required evidence | Result |
| --- | --- | --- |
| Installation/reboot | Versions, services, DNS/TLS, SSH, IPv4/IPv6 firewall, WireGuard | Pending |
| Authentication | Real passkeys, TOTP/recovery, CSRF, bearer revocation, SSE closure | Pending |
| Deployment | Exact SHA, hardening, no published ports, masked secrets | Pending |
| Switching/failure | Error-free traffic, rejected candidate preserving previous version | Pending |
| Application rollback | New build of previous SHA and expected response | Pending |
| GitHub | Push/check run and idempotent repeated delivery | Pending |
| Backup | Local/offsite archive, separate key, hash, recoverable S3 object if used | Pending |
| Restore | Online/corrupt/wrong-key rejection, login, peers, new deploy and backup | Pending |
| Update | Build waiting, agents before panel, applied job/helper, version/readiness | Pending |
| Backend rollback | Previous hash, rolled_back helper, stopped queue, rehearsed manual recovery | Pending |
| Performance | Real Go/Node/load measurements without fabricated values | Pending |

Store versions/commit, timings, results, and sanitized logs outside the repository. Never attach invitations, cookies, tokens, sentinel/credential files, keys, join.json, database dumps, or raw profiles. Remove staging bearer and temporary secret files after securing recovery copies. Promote only when the criteria required for your use are accepted. Replacement-VPS disaster recovery and application data/volumes require separate evidence.
