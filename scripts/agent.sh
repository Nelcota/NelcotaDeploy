#!/usr/bin/env bash
# Self-contained installer served by the panel.
set -euo pipefail
umask 077
fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }
usage() { printf '%s\n' 'agent.sh --panel-url HTTPS_URL --join-file FILE --release-url HTTPS_URL --signing-key PUBLIC_KEY'; }
panel='' token_file='' release='' signing_key=''
while (($#)); do
 case "$1" in
 --panel-url) panel=${2:?}; shift 2;;
 --join-file) token_file=${2:?}; shift 2;;
 --release-url) release=${2:?}; shift 2;;
 --signing-key) signing_key=${2:?}; shift 2;;
 --help) usage; exit 0;;
 *) fail 'Unknown argument';;
 esac
done
release=${release%/}
release_base=${release%/*}
[[ ${release##*/} =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Use an immutable URL ending in /vMAJOR.MINOR.PATCH'
[[ $EUID == 0 ]] || fail 'Run as root'
[[ $panel == https://* && $panel != *[$'\n\r ']* && $release == https://* && $release != *[$'\n\r ']* && -n $signing_key ]] || fail 'HTTPS URLs and trusted public key required'
[[ -f $token_file ]] || fail 'Invitation required'
[[ ! -e /etc/nelcota-agent/join.json && ! -e /etc/wireguard/wg0.conf ]] || fail 'Agent or wg0 already configured'
[[ ! -e /etc/caddy/Caddyfile ]] || fail 'Existing Caddy installation: preserve configuration and install manually'
# shellcheck source=/dev/null
source /etc/os-release
case "$ID:$VERSION_ID" in debian:1[2-9]*|ubuntu:2[2468].*) ;; *) fail 'Supported: Debian 12+ or Ubuntu 22.04+';; esac
# Avoid disabling the only access method before an SSH key is available.
key_found=false
for authorized in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
 if [[ -s $authorized ]]; then key_found=true; break; fi
done
[[ $key_found == true ]] || fail 'Configure and test SSH key access before installation'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg minisign git jq caddy wireguard-tools iptables iptables-persistent unattended-upgrades fail2ban
# Use the official repository with current Engine/containerd packages and a pinned signing identity.
install -d -m 0755 /etc/apt/keyrings
curl --proto '=https' --tlsv1.2 -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/nelcota-docker.asc
fingerprint=$(gpg --batch --show-keys --with-colons /etc/apt/keyrings/nelcota-docker.asc | awk -F: '$1=="fpr" {print $10; exit}')
[[ $fingerprint == 9DC858229FC7DD38854AE2D88D81803C0EBFCD88 ]] || fail 'Docker signing key does not match the pinned identity'
chmod 0644 /etc/apt/keyrings/nelcota-docker.asc
cat > /etc/apt/sources.list.d/nelcota-docker.sources <<APT
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/nelcota-docker.asc
APT
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
arch=$(uname -m)
case "$arch" in x86_64) arch=amd64_v1; if grep -qw avx2 /proc/cpuinfo && grep -qw bmi1 /proc/cpuinfo && grep -qw bmi2 /proc/cpuinfo && grep -qw fma /proc/cpuinfo && grep -qw f16c /proc/cpuinfo && grep -qw movbe /proc/cpuinfo && grep -qw xsave /proc/cpuinfo && grep -qw abm /proc/cpuinfo; then arch=amd64_v3; fi; buildarch=amd64;; aarch64) arch=arm64; buildarch=arm64;; *) fail 'Unsupported architecture';; esac
artifact="nelcota-agent_linux_${arch}"
# The maintainer release must also include audited and signed BuildKit binaries.
builder="buildkitd_linux_${buildarch}"
curl --proto '=https' --tlsv1.2 -fsSL "$release/checksums.txt" -o "$work/checksums.txt"
curl --proto '=https' --tlsv1.2 -fsSL "$release/checksums.txt.minisig" -o "$work/checksums.txt.minisig"
minisign -Vm "$work/checksums.txt" -x "$work/checksums.txt.minisig" -P "$signing_key"
for file in "$artifact" "$builder"; do
 curl --proto '=https' --tlsv1.2 -fsSL "$release/$file" -o "$work/$file"
 (cd "$work"; awk -v f="$file" '$2 == f {print}' checksums.txt > selected.sha256; [[ $(wc -l < selected.sha256) == 1 ]]; sha256sum -c selected.sha256)
done
install -o root -g root -m 0755 "$work/$artifact" /usr/local/bin/nelcota-agent
install -o root -g root -m 0755 "$work/$builder" /usr/local/bin/buildkitd
id nelcota-agent >/dev/null 2>&1 || useradd --system --home-dir /var/lib/nelcota-agent --shell /usr/sbin/nologin nelcota-agent
usermod -aG docker nelcota-agent
install -d -o nelcota-agent -g nelcota-agent -m 0700 /etc/nelcota-agent /var/lib/nelcota-agent
wg genkey > "$work/wg.key"
wg pubkey < "$work/wg.key" > "$work/wg.pub"
/usr/local/bin/nelcota-agent join --panel-url "$panel" --join-token-file "$token_file" --wg-public-key-file "$work/wg.pub"
join=/etc/nelcota-agent/join.json
address=$(jq -er '.address' "$join")
panel_address=$(jq -er '.panel_address' "$join")
endpoint=$(jq -er '.panel_endpoint' "$join")
pub=$(jq -er '.panel_wireguard_key' "$join")
[[ $address =~ ^10\.[0-9]+\.[0-9]+\.[0-9]+$ && $panel_address =~ ^10\.[0-9]+\.[0-9]+\.[0-9]+$ && $endpoint =~ ^[a-zA-Z0-9.-]+:[0-9]+$ && $pub =~ ^[a-zA-Z0-9+/]{43}=$ ]] || fail 'Received WireGuard configuration is invalid'
private=$(cat "$work/wg.key")
install -d -m 0700 /etc/wireguard
cat > /etc/wireguard/wg0.conf <<WG
[Interface]
Address = $address/32
PrivateKey = $private
[Peer]
PublicKey = $pub
AllowedIPs = $panel_address/32
Endpoint = $endpoint
PersistentKeepalive = 25
WG
unset private
chmod 0600 /etc/wireguard/wg0.conf
systemctl enable --now wg-quick@wg0
cat > /etc/systemd/system/nelcota-builds.slice <<'UNIT'
[Unit]
Description=NelcotaDeploy low-priority builds
[Slice]
CPUWeight=10
IOWeight=10
MemoryMax=2G
TasksMax=512
UNIT
mkdir -p /etc/buildkit
cat > /etc/buildkit/buildkitd.toml <<'TOML'
[worker.oci]
  enabled = true
  gc = true
  max-parallelism = 2
  defaultCgroupParent = "nelcota-builds.slice"
  [[worker.oci.gcpolicy]]
    keepDuration = 604800
    maxUsedSpace = "5GB"
  [[worker.oci.gcpolicy]]
    maxUsedSpace = "5GB"
[worker.containerd]
  enabled = false
TOML
cat > /etc/systemd/system/nelcota-buildkit.service <<'UNIT'
[Unit]
Description=NelcotaDeploy BuildKit (private socket)
After=network-online.target
[Service]
ExecStart=/usr/local/bin/buildkitd --config /etc/buildkit/buildkitd.toml --group nelcota-agent --addr unix:///run/buildkit/buildkitd.sock
Restart=on-failure
Slice=nelcota-builds.slice
Delegate=yes
RuntimeDirectory=buildkit
UMask=0007
# The worker needs mounts/namespaces: sandbox the agent, not the OCI daemon.
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/caddy/nelcota.json <<'CADDY'
{"admin":{"listen":"127.0.0.1:2019"},"apps":{"http":{"servers":{"nelcota":{"listen":[":443"],"routes":[],"automatic_https":{}}}}}}
CADDY
chown root:caddy /etc/caddy/nelcota.json
chmod 0640 /etc/caddy/nelcota.json
# The package may have started the default site. Seed autosave before using --resume.
systemctl stop caddy
install -d -o caddy -g caddy -m 0700 /var/lib/caddy/.config/caddy
install -o caddy -g caddy -m 0600 /etc/caddy/nelcota.json /var/lib/caddy/.config/caddy/autosave.json
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/nelcota.conf <<'UNIT'
[Service]
Environment=XDG_CONFIG_HOME=/var/lib/caddy/.config
Environment=XDG_DATA_HOME=/var/lib/caddy/.local/share
ExecStart=
ExecStart=/usr/bin/caddy run --environ --resume --config /etc/caddy/nelcota.json
ExecReload=
UNIT
cat > /etc/systemd/system/nelcota-agent.service <<'UNIT'
[Unit]
Description=NelcotaDeploy Agent
After=network-online.target docker.service nelcota-buildkit.service caddy.service wg-quick@wg0.service
Requires=docker.service nelcota-buildkit.service caddy.service wg-quick@wg0.service
[Service]
User=nelcota-agent
Group=nelcota-agent
SupplementaryGroups=docker
ExecStart=/usr/local/bin/nelcota-agent serve
Environment=GODEBUG=disablethp=1
Environment=GOMEMLIMIT=80MiB
MemoryMax=100M
Restart=on-failure
RestartSec=3
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
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
ReadWritePaths=/var/lib/nelcota-agent
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
# Only modify the dedicated chain. No app port is published.
systemctl enable --now docker
iptables -N NELCOTA-ISOLATION 2>/dev/null || true
iptables -C DOCKER-USER -j NELCOTA-ISOLATION 2>/dev/null || iptables -I DOCKER-USER 1 -j NELCOTA-ISOLATION
iptables -A NELCOTA-ISOLATION -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -A NELCOTA-ISOLATION -i br+ -o br+ -j DROP
iptables -A NELCOTA-ISOLATION -i docker0 -o br+ -j DROP
iptables -A NELCOTA-ISOLATION -i br+ -o docker0 -j DROP
# Forwarded public-interface traffic must never reach app bridges.
wan=$(ip -4 route show default | awk 'NR==1 {print $5}')
[[ $wan =~ ^[a-zA-Z0-9_-]+$ ]] || fail 'Public interface not identified'
iptables -A NELCOTA-ISOLATION -i "$wan" -o br+ -j DROP
iptables -A NELCOTA-ISOLATION -j RETURN
# Separate INPUT from Docker forwarding. Preserve administrative and proxy ports.
iptables -N NELCOTA-INPUT 2>/dev/null || true
iptables -A NELCOTA-INPUT -i lo -j ACCEPT
iptables -A NELCOTA-INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A NELCOTA-INPUT -p tcp -m multiport --dports 22,80,443 -j ACCEPT
iptables -A NELCOTA-INPUT -p udp --dport 443 -j ACCEPT
iptables -A NELCOTA-INPUT -p icmp -j ACCEPT
iptables -A NELCOTA-INPUT -i wg0 -j ACCEPT
iptables -A NELCOTA-INPUT -j DROP
iptables -I INPUT 1 -j NELCOTA-INPUT
# Block inbound IPv6 outside public ports; ICMPv6 preserves ND/PMTU.
ip6tables -N NELCOTA-INPUT 2>/dev/null || true
ip6tables -A NELCOTA-INPUT -i lo -j ACCEPT
ip6tables -A NELCOTA-INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -A NELCOTA-INPUT -p ipv6-icmp -j ACCEPT
ip6tables -A NELCOTA-INPUT -p tcp -m multiport --dports 22,80,443 -j ACCEPT
ip6tables -A NELCOTA-INPUT -p udp --dport 443 -j ACCEPT
ip6tables -A NELCOTA-INPUT -j DROP
ip6tables -I INPUT 1 -j NELCOTA-INPUT
netfilter-persistent save
mkdir -p /etc/ssh/sshd_config.d
printf '%s\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' > /etc/ssh/sshd_config.d/99-nelcota.conf
sshd -t
systemctl reload ssh
chown -R nelcota-agent:nelcota-agent /etc/nelcota-agent /var/lib/nelcota-agent
# The service user can request a version; only this fixed root helper installs it.
jq -n --arg base "$release_base" --arg key "$signing_key" --arg target "$arch" '{base_url:$base,public_key:$key,target:$target}' > /etc/nelcota-release-agent.json
chown root:root /etc/nelcota-release-agent.json
chmod 0644 /etc/nelcota-release-agent.json
install -d -m 0700 -o nelcota-agent -g nelcota-agent /var/lib/nelcota-agent/update
cat > /etc/systemd/system/nelcota-agent-update.path <<'UNIT'
[Unit]
Description=Nelcota agent signed update request
[Path]
PathExists=/var/lib/nelcota-agent/update/request.json
Unit=nelcota-agent-update.service
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/nelcota-agent-update.service <<'UNIT'
[Unit]
Description=Nelcota agent signed update helper
ConditionPathExists=/var/lib/nelcota-agent/update/request.json
[Service]
Type=oneshot
ExecStart=/usr/local/bin/nelcota-agent apply-update
TimeoutStartSec=10min
UMask=0077
LimitCORE=0
PrivateTmp=true
ProtectHome=true
NoNewPrivileges=true
UNIT
systemctl daemon-reload
systemctl enable --now nelcota-agent-update.path
mkdir -p /etc/fail2ban/jail.d
printf '%s\n' '[sshd]' 'enabled = true' 'backend = systemd' > /etc/fail2ban/jail.d/nelcota.local
printf '%s\n' 'APT::Periodic::Update-Package-Lists "1";' 'APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20nelcota-upgrades
systemctl restart caddy
systemctl enable --now nelcota-buildkit nelcota-agent unattended-upgrades fail2ban
printf '%s\n' 'Agent installed; no public control listener.'
