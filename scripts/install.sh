#!/usr/bin/env bash
# Instalação do painel; revisar antes de executar como root.
set -euo pipefail
umask 077
fail() { printf 'Erro: %s\n' "$1" >&2; exit 1; }
usage() { printf '%s\n' 'install.sh panel --domain HOST --email EMAIL --release-url HTTPS_URL --signing-key MINISIGN_PUBLIC_KEY [--wg-endpoint HOST:51820]'; }
domain='' email='' release='' signing_key='' endpoint=''
[[ ${1:-} == panel ]] && shift
while (($#)); do
  case "$1" in
    --domain) domain=${2:?}; shift 2;;
    --email) email=${2:?}; shift 2;;
    --release-url) release=${2:?}; shift 2;;
    --signing-key) signing_key=${2:?}; shift 2;;
    --wg-endpoint) endpoint=${2:?}; shift 2;;
    --help) usage; exit 0;;
    *) fail 'Argumento desconhecido';;
  esac
done
[[ $EUID == 0 ]] || fail 'Execute como root'
[[ $domain =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && $domain == *.* ]] || fail 'Domínio inválido'
[[ $email == *@* && $email != *$'\n'* ]] || fail 'E-mail inválido'
[[ $release == https://* && $release != *[$'\n\r ']* && -n $signing_key ]] || fail 'Release HTTPS e chave pública confiável obrigatórias'
[[ -n $endpoint ]] || endpoint="$domain:51820"
[[ $endpoint =~ ^[a-zA-Z0-9.-]+:[0-9]+$ ]] || fail 'Endpoint WireGuard inválido'
# shellcheck source=/dev/null
source /etc/os-release
case "$ID:$VERSION_ID" in debian:1[2-9]*|ubuntu:2[2468].*) ;; *) fail 'Suporte: Debian 12+ ou Ubuntu 22.04+';; esac
[[ ! -e /etc/nelcota/master.key ]] || fail 'Instalação existente; preserve os dados e use atualização verificada'
[[ ! -e /etc/caddy/Caddyfile ]] || fail 'Caddy existente: preserve a configuração e instale manualmente'
# Evita desligar o único método de acesso antes de existir uma chave SSH.
key_found=false
for authorized in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
 if [[ -s $authorized ]]; then key_found=true; break; fi
done
[[ $key_found == true ]] || fail 'Configure e teste acesso SSH por chave antes da instalação'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl minisign caddy wireguard-tools nftables jq unattended-upgrades fail2ban
arch=$(uname -m)
case "$arch" in x86_64) arch=amd64_v1; if grep -qw avx2 /proc/cpuinfo && grep -qw bmi1 /proc/cpuinfo && grep -qw bmi2 /proc/cpuinfo && grep -qw fma /proc/cpuinfo && grep -qw f16c /proc/cpuinfo && grep -qw movbe /proc/cpuinfo && grep -qw xsave /proc/cpuinfo && grep -qw abm /proc/cpuinfo; then arch=amd64_v3; fi;; aarch64) arch=arm64;; *) fail 'Arquitetura não suportada';; esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
artifact="nelcota-panel_linux_${arch}"
curl --proto '=https' --tlsv1.2 -fsSL "$release/$artifact" -o "$work/$artifact"
curl --proto '=https' --tlsv1.2 -fsSL "$release/checksums.txt" -o "$work/checksums.txt"
curl --proto '=https' --tlsv1.2 -fsSL "$release/checksums.txt.minisig" -o "$work/checksums.txt.minisig"
minisign -Vm "$work/checksums.txt" -x "$work/checksums.txt.minisig" -P "$signing_key"
(cd "$work"; awk -v f="$artifact" '$2 == f {print}' checksums.txt > selected.sha256; [[ $(wc -l < selected.sha256) == 1 ]]; sha256sum -c selected.sha256)
id nelcota >/dev/null 2>&1 || useradd --system --home-dir /var/lib/nelcota --shell /usr/sbin/nologin nelcota
install -o root -g root -m 0755 "$work/$artifact" /usr/local/bin/nelcota-panel
install -d -o nelcota -g nelcota -m 0700 /etc/nelcota /var/lib/nelcota
install -d -m 0700 /etc/wireguard
[[ ! -e /etc/wireguard/wg0.conf ]] || fail 'wg0 já configurada; configuração manual necessária'
wg genkey > "$work/wg.key"
wg pubkey < "$work/wg.key" > /etc/nelcota/wg.pub
private=$(cat "$work/wg.key")
cat > /etc/wireguard/wg0.conf <<WG
[Interface]
Address = 10.77.0.1/24
ListenPort = 51820
PrivateKey = $private
SaveConfig = true
WG
unset private
chmod 0600 /etc/wireguard/wg0.conf
systemctl enable --now wg-quick@wg0
wgpub=$(cat /etc/nelcota/wg.pub)
cat > /etc/nelcota/panel.env <<ENV
NELCOTA_ORIGIN=https://$domain
NELCOTA_WG_ENDPOINT=$endpoint
NELCOTA_WG_PUBLIC_KEY=$wgpub
ENV
chown nelcota:nelcota /etc/nelcota/panel.env /etc/nelcota/wg.pub
/usr/local/bin/nelcota-panel --origin "https://$domain" init --email "$email" > /etc/nelcota/first-access.json
chown -R nelcota:nelcota /etc/nelcota /var/lib/nelcota
chmod 0600 /etc/nelcota/first-access.json
# Não sobrescreva sites existentes.
[[ ! -s /etc/caddy/Caddyfile || ! -e /etc/nelcota/caddy-installed ]] || fail 'Caddy já gerenciado'
cp /etc/caddy/Caddyfile "$work/Caddyfile.previous"
cat > /etc/caddy/Caddyfile <<CADDY
$domain {
    reverse_proxy 127.0.0.1:8080
}
CADDY
caddy validate --config /etc/caddy/Caddyfile
: > /etc/nelcota/caddy-installed
cat > /etc/systemd/system/nelcota-panel.service <<'UNIT'
[Unit]
Description=Nelcota Deploy Panel
After=network-online.target wg-quick@wg0.service
Requires=wg-quick@wg0.service
[Service]
User=nelcota
Group=nelcota
EnvironmentFile=/etc/nelcota/panel.env
Environment=GOMEMLIMIT=200MiB
ExecStart=/usr/local/bin/nelcota-panel serve
Restart=on-failure
RestartSec=3
MemoryMax=256M
LimitCORE=0
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
CapabilityBoundingSet=CAP_NET_ADMIN
AmbientCapabilities=CAP_NET_ADMIN
ReadWritePaths=/var/lib/nelcota
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
# Firewall em tabela própria; conserva regras existentes e o SSH por chave.
nft list table inet nelcota >/dev/null 2>&1 && fail 'Firewall nelcota já existe; revise manualmente'
cat > /etc/nelcota/firewall.nft <<'NFT'
table inet nelcota {
 chain input { type filter hook input priority 0; policy drop;
  iifname "lo" accept
  ct state established,related accept
  iifname "wg0" accept
  meta l4proto { icmp, ipv6-icmp } accept
  tcp dport { 22, 80, 443 } accept
  udp dport { 443, 51820 } accept
 }
}
NFT
nft -c -f /etc/nelcota/firewall.nft
nft -f /etc/nelcota/firewall.nft
cat > /etc/systemd/system/nelcota-firewall.service <<'UNIT'
[Unit]
Description=Nelcota firewall
Before=nelcota-panel.service
After=network-pre.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/nelcota/firewall.nft
[Install]
WantedBy=multi-user.target
UNIT
mkdir -p /etc/ssh/sshd_config.d
printf '%s\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' > /etc/ssh/sshd_config.d/99-nelcota.conf
sshd -t
systemctl reload ssh
mkdir -p /etc/fail2ban/jail.d
printf '%s\n' '[sshd]' 'enabled = true' 'backend = systemd' > /etc/fail2ban/jail.d/nelcota.local
printf '%s\n' 'APT::Periodic::Update-Package-Lists "1";' 'APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20nelcota-upgrades
systemctl enable --now unattended-upgrades fail2ban
systemctl daemon-reload
systemctl enable nelcota-firewall.service
systemctl enable --now nelcota-panel
systemctl reload caddy
printf 'Painel instalado em https://%s. Convite inicial (15 min) em /etc/nelcota/first-access.json, acesso root.\n' "$domain"
