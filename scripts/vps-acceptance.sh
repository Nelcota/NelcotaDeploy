#!/usr/bin/env bash
# Disposable VPS acceptance on Hetzner Cloud.
#
# UNVERIFIED: this script has only been checked with ShellCheck and bash -n. It
# has not run against Hetzner Cloud yet; treat its first real run as part of
# the acceptance work (docs/development.md#disposable-vps-acceptance).
#
# It creates throwaway Debian 12 servers with an ephemeral SSH key, installs the
# panel with scripts/install.sh exactly as docs/vps-testing.md documents, runs
# smoke checks, reboots the panel and checks again, and always deletes every
# resource it created. All resources carry the label nelcota-acceptance=RUN_ID,
# so `cleanup --run-id RUN_ID` can remove leftovers from an interrupted run.
#
# Agent enrollment needs an invitation created from a passkey-authenticated
# panel session, which cannot be automated without a browser. With the agent
# stage enabled, the agent server runs scripts/agent.sh with an invitation the
# panel has never issued: the run verifies everything up to enrollment (signed
# artifacts, Docker from the pinned repository, BuildKit) and that the panel
# rejects the unknown invitation. Full registration stays in docs/vps-testing.md.
#
# Usage:
#   HCLOUD_TOKEN=... scripts/vps-acceptance.sh run --release-url URL --signing-key KEY [options]
#   HCLOUD_TOKEN=... scripts/vps-acceptance.sh cleanup --run-id RUN_ID
# Options for run:
#   --run-id ID           label value for created resources (default: local-<random>)
#   --location NAME       Hetzner location (default: fsn1)
#   --server-type NAME    Hetzner server type (default: cx23)
#   --image NAME          image (default: debian-12)
#   --domain-suffix NAME  wildcard DNS service mapping IPs to names (default: sslip.io)
#   --email ADDRESS       first administrator (default: acceptance@example.com)
#   --skip-agent          create only the panel server
#   --output-dir DIR      logs and summary (default: a new temporary directory)
# Requires: hcloud, jq, curl, minisign, ssh, scp, ssh-keygen.
set -euo pipefail
umask 077
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }
label=nelcota-acceptance
root=$(cd "$(dirname "$0")/.." && pwd)

valid_run_id() { [[ $1 =~ ^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$ ]]; }

# list_ids KIND RUN_ID prints the IDs of servers or SSH keys carrying the run label.
list_ids() { hcloud "$1" list --selector "$label=$2" -o json | jq -r '(. // [])[] | .id'; }

# cleanup_run RUN_ID deletes every server and SSH key labeled with RUN_ID and
# fails when anything remains afterwards.
cleanup_run() {
	local run=$1 kind id remaining=0
	for kind in server ssh-key; do
		while read -r id; do
			[[ -n $id ]] || continue
			log "Deleting $kind $id"
			hcloud "$kind" delete "$id" >/dev/null || log "Deleting $kind $id failed; will recheck"
		done < <(list_ids "$kind" "$run" || true)
	done
	for kind in server ssh-key; do
		if [[ -n $(list_ids "$kind" "$run") ]]; then
			log "Some ${kind}s labeled $label=$run still exist"
			remaining=1
		fi
	done
	((remaining == 0)) || { log 'Delete them manually in the Hetzner Cloud console'; return 1; }
	log "No resources labeled $label=$run remain"
}

require_tools() {
	local tool
	for tool in "$@"; do
		command -v "$tool" >/dev/null 2>&1 || fail "$tool is required"
	done
	[[ -n ${HCLOUD_TOKEN:-} ]] || fail 'HCLOUD_TOKEN must be set (it is read by hcloud and never printed)'
}

command=${1:-}
(($#)) && shift
case $command in
cleanup)
	run_id=''
	while (($#)); do
		case $1 in
		--run-id) run_id=${2:?}; shift 2 ;;
		*) fail "Unknown argument: $1" ;;
		esac
	done
	valid_run_id "$run_id" || fail 'cleanup needs --run-id with lowercase letters, digits, and hyphens'
	require_tools hcloud jq
	cleanup_run "$run_id"
	exit
	;;
run) ;;
*) fail 'Usage: scripts/vps-acceptance.sh run|cleanup [options] (see the header of this script)' ;;
esac

release_url='' signing_key='' run_id="local-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
location=fsn1 server_type=cx23 image=debian-12 domain_suffix=sslip.io email=acceptance@example.com
with_agent=true out=''
while (($#)); do
	case $1 in
	--release-url) release_url=${2:?}; shift 2 ;;
	--signing-key) signing_key=${2:?}; shift 2 ;;
	--run-id) run_id=${2:?}; shift 2 ;;
	--location) location=${2:?}; shift 2 ;;
	--server-type) server_type=${2:?}; shift 2 ;;
	--image) image=${2:?}; shift 2 ;;
	--domain-suffix) domain_suffix=${2:?}; shift 2 ;;
	--email) email=${2:?}; shift 2 ;;
	--skip-agent) with_agent=false; shift ;;
	--output-dir) out=${2:?}; shift 2 ;;
	*) fail "Unknown argument: $1" ;;
	esac
done
require_tools hcloud jq curl minisign ssh scp ssh-keygen
release_url=${release_url%/}
version=${release_url##*/}
[[ $release_url == https://* && $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail '--release-url must be an HTTPS URL ending in /vMAJOR.MINOR.PATCH'
[[ -n $signing_key && $signing_key != *[[:space:]]* ]] || fail '--signing-key must be the Minisign public key'
valid_run_id "$run_id" || fail '--run-id must use lowercase letters, digits, and hyphens (max 40)'
[[ $location =~ ^[a-z0-9-]+$ && $server_type =~ ^[a-z0-9-]+$ && $image =~ ^[a-z0-9.-]+$ && $domain_suffix =~ ^[a-z0-9.-]+$ ]] || fail 'Invalid location, server type, image, or domain suffix'
work=$(mktemp -d)
[[ -n $out ]] || out=$work/out
mkdir -p "$out"
out=$(cd "$out" && pwd)
summary=$out/summary.md
# shellcheck disable=SC2016 # Backticks are Markdown code spans.
printf '# VPS acceptance %s\n\nRelease `%s`, image `%s`, type `%s`, location `%s`.\n\n' "$run_id" "$version" "$image" "$server_type" "$location" > "$summary"
result() { printf -- '- %s\n' "$1" >> "$summary"; log "$1"; }

finish() {
	local status=$?
	trap - EXIT
	set +e
	log 'Cleaning up'
	if cleanup_run "$run_id"; then result 'Cleanup: all servers and SSH keys deleted'; else result 'Cleanup: FAILED, resources remain'; status=1; fi
	if ((status == 0)); then result 'Result: passed'; else result 'Result: FAILED'; fi
	[[ -z ${GITHUB_STEP_SUMMARY:-} ]] || cat "$summary" >> "$GITHUB_STEP_SUMMARY"
	rm -rf -- "$work"
	log "Logs and summary: $out"
	exit "$status"
}

# Verify the release on the runner before paying for servers.
log "Verifying the signed manifest of $version"
for file in checksums.txt checksums.txt.minisig release.json; do
	curl --proto '=https' --tlsv1.2 -fsSL "$release_url/$file" -o "$work/$file"
done
minisign -Vm "$work/checksums.txt" -x "$work/checksums.txt.minisig" -P "$signing_key" >/dev/null || fail 'The release manifest signature does not verify with --signing-key'
(cd "$work" && awk '$2 == "release.json"' checksums.txt | sha256sum --check --status -) || fail 'release.json does not match the signed manifest'
[[ $(jq -er .version "$work/release.json") == "$version" ]] || fail "release.json does not describe $version"

ssh-keygen -q -t ed25519 -N '' -C "$label-$run_id" -f "$work/id_ed25519"
ssh_opts=(-i "$work/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15
	-o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$work/known_hosts" -o LogLevel=ERROR)
# remote HOST ARGV... runs one command; each argument is quoted for the remote
# (Bash) login shell, so client-side expansion is intended.
# shellcheck disable=SC2029
remote() { local host=$1; shift; ssh "${ssh_opts[@]}" "root@$host" "$(printf '%q ' "$@")"; }
# remote_sh HOST SCRIPT runs a fixed shell snippet written in this file.
# shellcheck disable=SC2029
remote_sh() { ssh "${ssh_opts[@]}" "root@$1" "$2"; }
upload() { scp "${ssh_opts[@]}" "$2" "root@$1:$3"; }

trap finish EXIT
log "Creating resources labeled $label=$run_id"
hcloud ssh-key create --name "nelcota-acc-$run_id" --public-key-from-file "$work/id_ed25519.pub" --label "$label=$run_id" >/dev/null
create_server() {
	hcloud server create --name "nelcota-acc-$run_id-$1" --type "$server_type" --image "$image" --location "$location" \
		--ssh-key "nelcota-acc-$run_id" --label "$label=$run_id" -o json | jq -er '.server.public_net.ipv4.ip'
}
panel_ip=$(create_server panel)
domain="${panel_ip//./-}.$domain_suffix"
result "Panel server created at $panel_ip ($domain)"
agent_ip=''
if [[ $with_agent == true ]]; then
	agent_ip=$(create_server agent)
	result "Agent server created at $agent_ip"
fi

wait_ssh() {
	local host=$1 deadline=$((SECONDS + 300))
	until remote "$host" true 2>/dev/null; do
		((SECONDS < deadline)) || fail "SSH to $host did not become available"
		sleep 5
	done
	# Let first-boot provisioning finish so apt is not locked during installation.
	remote_sh "$host" 'cloud-init status --wait >/dev/null 2>&1 || true'
}
wait_ssh "$panel_ip"
[[ -z $agent_ip ]] || wait_ssh "$agent_ip"

# Stage 2 of docs/vps-testing.md: upload the reviewed installer and run it.
log 'Installing the panel'
upload "$panel_ip" "$root/scripts/install.sh" /root/nelcota-install.sh
remote "$panel_ip" bash -n /root/nelcota-install.sh
remote "$panel_ip" bash /root/nelcota-install.sh panel --domain "$domain" --email "$email" \
	--wg-endpoint "$panel_ip:51820" --release-url "$release_url" --signing-key "$signing_key" > "$out/panel-install.log" 2>&1 ||
	{ tail -n 40 "$out/panel-install.log" >&2; fail 'Panel installation failed; see panel-install.log'; }
result 'Panel installed with scripts/install.sh'

panel_checks() {
	local phase=$1 deadline
	remote "$panel_ip" nelcota-panel version | grep -qF "$version" || fail "$phase: nelcota-panel version is not $version"
	remote "$panel_ip" systemctl is-active --quiet nelcota-panel wg-quick@wg0 caddy || fail "$phase: panel services are not active"
	remote "$panel_ip" systemctl is-enabled --quiet nelcota-panel nelcota-panel-update.path nelcota-firewall.service || fail "$phase: panel units are not enabled"
	remote "$panel_ip" nft list table inet nelcota >/dev/null || fail "$phase: the Nelcota firewall table is missing"
	remote "$panel_ip" curl --fail --silent --show-error http://127.0.0.1:8080/healthz >/dev/null || fail "$phase: the loopback health check failed"
	[[ $(remote "$panel_ip" stat -c %a /etc/nelcota/first-access.json) == 600 ]] || fail "$phase: first-access.json is not mode 0600"
	deadline=$((SECONDS + 300))
	until curl --proto '=https' --fail --silent --show-error --max-time 10 "https://$domain/healthz" >/dev/null 2>&1; do
		((SECONDS < deadline)) || fail "$phase: https://$domain/healthz did not answer with a valid certificate"
		sleep 10
	done
	if curl --silent --max-time 5 "http://$panel_ip:8080/healthz" >/dev/null 2>&1; then
		fail "$phase: the internal HTTP port 8080 is reachable from the internet"
	fi
	result "$phase: version $version, services active and enabled, firewall loaded, loopback and public HTTPS health checks pass, port 8080 closed"
}
panel_checks 'Panel after installation'

if [[ -n $agent_ip ]]; then
	log 'Running the agent installer up to enrollment'
	upload "$agent_ip" "$root/scripts/agent.sh" /root/nelcota-agent-install.sh
	remote "$agent_ip" bash -n /root/nelcota-agent-install.sh
	# An invitation the panel never issued; enrollment must be rejected.
	remote_sh "$agent_ip" 'umask 077; od -An -N32 -tx1 /dev/urandom | tr -d " \n" > /root/nelcota-join'
	if remote "$agent_ip" bash /root/nelcota-agent-install.sh --panel-url "https://$domain" --join-file /root/nelcota-join \
		--release-url "$release_url" --signing-key "$signing_key" > "$out/agent-install.log" 2>&1; then
		fail 'The agent installer accepted an invitation the panel never issued'
	fi
	remote "$agent_ip" /usr/local/bin/nelcota-agent version | grep -qF "$version" || { tail -n 40 "$out/agent-install.log" >&2; fail 'The agent executable was not installed from the signed release'; }
	remote "$agent_ip" /usr/local/bin/buildkitd --version > /dev/null || fail 'BuildKit was not installed from the signed release'
	remote "$agent_ip" systemctl is-active --quiet docker || fail 'Docker is not active on the agent server'
	remote "$agent_ip" test ! -e /etc/nelcota-agent/join.json || fail 'The agent stored enrollment state for an unknown invitation'
	result 'Agent installer: signed agent and BuildKit installed, Docker active, unknown invitation rejected (registration itself needs a passkey session; see docs/vps-testing.md)'
fi

log 'Rebooting the panel'
boot_id=$(remote "$panel_ip" cat /proc/sys/kernel/random/boot_id)
remote "$panel_ip" systemctl reboot >/dev/null 2>&1 || true
deadline=$((SECONDS + 600))
until new_boot=$(remote "$panel_ip" cat /proc/sys/kernel/random/boot_id 2>/dev/null) && [[ $new_boot != "$boot_id" ]]; do
	((SECONDS < deadline)) || fail 'The panel did not come back after reboot'
	sleep 10
done
deadline=$((SECONDS + 120))
until remote "$panel_ip" systemctl is-active --quiet nelcota-panel 2>/dev/null; do
	((SECONDS < deadline)) || fail 'nelcota-panel did not start after reboot'
	sleep 5
done
panel_checks 'Panel after reboot'
remote "$panel_ip" journalctl -b -u nelcota-panel -u caddy -u wg-quick@wg0 --no-pager -n 200 > "$out/panel-journal.log" 2>&1 || true
