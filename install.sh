#!/usr/bin/env bash
set -euo pipefail
umask 077
export LC_ALL=C

readonly install_dir=/opt/nelcota-deploy
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
readonly source_dir
readonly password_file="$install_dir/initial-admin-password"
readonly docker_socket=/var/run/docker.sock
readonly domain_pattern='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
readonly email_pattern='^([a-z0-9_+-]+(\.[a-z0-9_+-]+)*)@(([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$'
readonly release_image_pattern='^ghcr\.io/nelcota/nelcotadeploy@sha256:[a-f0-9]{64}$'
readonly service_timeout_seconds=180
readonly public_health_attempts=3
readonly public_health_timeout_seconds=10
readonly public_health_retry_delay_seconds=2
readonly secret_bytes=32
readonly password_bytes=24
readonly installation_id_bytes=16
readonly curl_resolve_error=6
readonly curl_timeout_error=28
readonly curl_certificate_error=60

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf 'Usage: sudo bash install.sh [--domain deploy.example.com] [--email admin@example.com]\n'
  printf '       sudo bash install.sh --update\n'
}

docker_local() {
  docker --host "unix://$docker_socket" "$@"
}

compose() {
  compose_from "$install_dir" "$@"
}

compose_from() {
  local directory=$1
  shift
  docker_local compose --project-directory "$directory" --project-name nelcota \
    --env-file "$directory/.env" --file "$directory/docker-compose.yml" \
    --file "$directory/docker-compose.override.yml" "$@"
}

configure_docker_repository() {
  local distribution=$1 suite=$2 targets architecture
  targets=$(apt-get indextargets --format "\$(URI)") || fail 'Could not read the configured apt sources.'
  if grep -Fq "://download.docker.com/linux/$distribution/dists/$suite/" <<< "$targets"; then
    return
  fi

  local repository="https://download.docker.com/linux/$distribution"
  local keyring=/etc/apt/keyrings/nelcota-docker.asc
  local source=/etc/apt/sources.list.d/nelcota-docker.sources
  architecture=$(dpkg --print-architecture)
  install -d -m 0755 /etc/apt/keyrings
  curl --fail --silent --show-error --location --retry 3 --max-time 30 \
    "$repository/gpg" -o "$install_dir/docker-key.tmp"
  install -m 0644 "$install_dir/docker-key.tmp" "$keyring"
  rm -f -- "$install_dir/docker-key.tmp"

  cat > "$source.tmp" <<EOF
Types: deb
URIs: $repository
Suites: $suite
Components: stable
Architectures: $architecture
Signed-By: $keyring
EOF
  chmod 0644 "$source.tmp"
  mv -T -- "$source.tmp" "$source"
  apt-get update --error-on=any
}

ensure_docker() {
  if command -v docker >/dev/null; then
    docker_local compose version >/dev/null ||
      fail 'Install the Docker Compose plugin for your existing Docker Engine, then rerun.'
  else
    # shellcheck source=/dev/null
    . /etc/os-release
    case "$ID" in
      ubuntu|debian) ;;
      *) fail 'Automatic Docker installation supports Ubuntu and Debian. Install Docker Engine and its Compose plugin, then rerun.' ;;
    esac
    local suite=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}
    [[ "$suite" =~ ^[a-z]+$ ]] || fail 'Could not determine the release codename for the Docker apt repository.'

    printf 'Installing Docker Engine and Compose from the official Docker repository.\n'
    apt-get update --error-on=any
    DEBIAN_FRONTEND=noninteractive apt-get install --no-remove -y ca-certificates curl iproute2 openssl
    configure_docker_repository "$ID" "$suite"
    DEBIAN_FRONTEND=noninteractive apt-get install --no-remove -y \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
  fi

  if ! docker_local info >/dev/null 2>&1; then
    systemctl start docker || fail 'Could not start Docker. Check systemctl status docker, then rerun.'
    docker_local info >/dev/null || fail "Docker is unavailable at $docker_socket."
  fi
}

check_managed_resources() {
  local kind=$1 names resource owner
  shift
  names=$(docker_local "$kind" ls --format '{{.Name}}') || fail "Could not list Docker resources of type $kind."
  for resource in "$@"; do
    if grep -Fxq "$resource" <<< "$names"; then
      owner=$(docker_local "$kind" inspect --format '{{index .Labels "io.nelcota.installation-id"}}' "$resource") ||
        fail "Could not inspect Docker $kind $resource."
      [[ -n "$installation_id" && "$owner" == "$installation_id" ]] ||
        fail "Docker $kind $resource belongs to another installation or has no installer label. Check which installation owns it."
    fi
  done
}

check_docker_resources() {
  local containers container working_dir
  containers=$(docker_local ps -aq --filter label=com.docker.compose.project=nelcota)
  while IFS= read -r container; do
    if [[ -z "$container" ]]; then
      continue
    fi

    working_dir=$(docker_local inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container")
    [[ "$working_dir" == "$install_dir" && -f "$install_dir/.env" ]] ||
      fail "Docker Compose project 'nelcota' is already in use by $working_dir. Manage that installation from its original directory."
  done <<< "$containers"

  check_managed_resources volume nelcota_data nelcota_routes nelcota_letsencrypt
  check_managed_resources network nelcota nelcota-control
}

check_ports() {
  local ingress listeners published_ports
  if [[ -f "$install_dir/.env" ]]; then
    ingress=$(compose ps --status running -q traefik)
    if [[ -n "$ingress" ]]; then
      return
    fi
  fi

  listeners=$(ss -H -ltn '( sport = :80 or sport = :443 )')
  published_ports=$(docker_local ps --format '{{.Ports}}')
  [[ -z "$listeners" && ! "$published_ports" =~ :(80|443)-\> ]] ||
    fail 'TCP port 80 or 443 is already in use. Free both ports before starting Traefik.'
}

check_dns() {
  local addresses address route
  addresses=$(getent ahosts "$domain" | awk '$2 == "STREAM" {print $1}' | sort -u) ||
    fail "DNS could not resolve $domain. Point an A or AAAA record to this VPS, then rerun."
  [[ -n "$addresses" ]] || fail "No usable DNS address found for $domain."

  while IFS= read -r address; do
    if route=$(ip route get "$address" 2>/dev/null) && [[ "$route" == 'local '* ]]; then
      continue
    fi

    # NAT and DNS proxies can legitimately use addresses absent from the local interfaces.
    printf 'Warning: %s resolves to %s outside the local interfaces. The installer will verify HTTPS after startup.\n' \
      "$domain" "$address" >&2
  done <<< "$addresses"
}

copy_release_files() {
  local directory=$1
  install -d -m 0700 "$directory/deploy/traefik"
  install -m 0600 "$source_dir/docker-compose.yml" "$directory/docker-compose.yml"
  install -m 0600 "$source_dir/deploy/compose.install.yml" "$directory/docker-compose.override.yml"
  # Traefik reads the bind-mounted file from inside the container.
  install -m 0644 "$source_dir/deploy/traefik/panel.yml" "$directory/deploy/traefik/panel.yml"
}

write_configuration() {
  local image=$1 docker_gid auth_secret encryption_key webhook_secret
  docker_gid=$(stat -c '%g' "$docker_socket")
  auth_secret=$(openssl rand -base64 "$secret_bytes")
  encryption_key=$(openssl rand -base64 "$secret_bytes")
  webhook_secret=$(openssl rand -hex "$secret_bytes")
  installation_id=$(openssl rand -hex "$installation_id_bytes")
  copy_release_files "$install_dir"

  if [[ ! -f "$password_file" ]]; then
    install -m 0600 /dev/null "$password_file.tmp"
    openssl rand -hex "$password_bytes" > "$password_file.tmp"
    mv -T -- "$password_file.tmp" "$password_file"
  fi

  install -m 0600 /dev/null "$install_dir/.env.tmp"
  cat > "$install_dir/.env.tmp" <<EOF
PANEL_DOMAIN=$domain
ACME_EMAIL=$email
NELCOTA_INSTALL_ADMIN_EMAIL=$email
NELCOTA_INSTALL_ID=$installation_id
NELCOTA_IMAGE=$image
DOCKER_GID=$docker_gid
BETTER_AUTH_SECRET=$auth_secret
DISABLE_PUBLIC_SETUP=true
NELCOTA_ENCRYPTION_KEY=$encryption_key
GITHUB_WEBHOOK_SECRET=$webhook_secret
EOF
  mv -T -- "$install_dir/.env.tmp" "$install_dir/.env"
}

read_saved_configuration() {
  local directory=$1
  local configuration saved_domain saved_email
  configuration=$(compose_from "$directory" config --environment)
  saved_domain=$(awk -F= '$1 == "PANEL_DOMAIN" {print $2}' <<< "$configuration")
  saved_email=$(awk -F= '$1 == "NELCOTA_INSTALL_ADMIN_EMAIL" {print $2}' <<< "$configuration")
  [[ -z "$domain" || "$domain" == "$saved_domain" ]] || fail "The installed panel uses $saved_domain."
  [[ -z "$email" || "$email" == "$saved_email" ]] || fail 'The installation already has a configured administrator email.'
  domain=$saved_domain
  email=$saved_email
  image=$(awk -F= '$1 == "NELCOTA_IMAGE" {print $2}' <<< "$configuration")
}

check_panel_address() {
  [[ ${#domain} -le 253 && "$domain" =~ $domain_pattern ]] || fail 'Enter a valid domain without a scheme, port or path.'
  [[ ${#email} -le 254 && "$email" =~ $email_pattern ]] || fail 'Enter a valid administrator email address.'
  [[ ${#BASH_REMATCH[1]} -le 64 ]] || fail 'The administrator email local part exceeds 64 characters.'
  check_dns
}

configure() {
  local image
  if [[ -f "$install_dir/.env" ]]; then
    read_saved_configuration "$install_dir"
  else
    if [[ -z "$domain" && -t 0 ]]; then
      read -r -p 'Panel domain (for example deploy.example.com): ' domain || fail 'No domain provided.'
    fi

    if [[ -z "$email" && -t 0 ]]; then
      read -r -p 'Administrator email (also used for TLS): ' email || fail 'No email provided.'
    fi

    domain=${domain,,}
    email=${email,,}
    if [[ -f "$source_dir/deploy/release-image" ]]; then
      image=$(< "$source_dir/deploy/release-image")
      [[ "$image" =~ $release_image_pattern ]] || fail 'The release bundle has an invalid image digest.'
    else
      [[ -f "$source_dir/Dockerfile" ]] || fail 'Extract the complete release bundle before running install.sh.'
      image=nelcota-deploy:local
    fi
  fi

  check_panel_address

  if [[ ! -f "$install_dir/.env" ]]; then
    if [[ "$image" == nelcota-deploy:local ]]; then
      printf 'Building the local checkout.\n'
      docker_local build --tag "$image" "$source_dir"
    fi

    write_configuration "$image"
  fi

  if [[ "$image" == nelcota-deploy:local ]]; then
    docker_local image inspect "$image" >/dev/null 2>&1 ||
      fail 'The local image is missing. Rebuild it with docker build --tag nelcota-deploy:local from the original checkout.'
    compose pull traefik
  else
    [[ "$image" =~ $release_image_pattern ]] || fail 'The installed image reference is invalid.'
    compose pull web traefik
  fi
}

start_web() {
  printf 'Starting the panel on its internal Docker network.\n'
  compose up --wait --wait-timeout "$service_timeout_seconds" --no-build web ||
    fail "The panel failed to start. Run docker compose --project-directory $install_dir logs web."
}

start_panel() {
  local password=''
  start_web

  if [[ -f "$password_file" ]]; then
    password=$(< "$password_file")
    [[ "$password" =~ ^[a-f0-9]{48}$ ]] || fail "The password file at $password_file is invalid."
  fi

  # Docker reads the value from the environment instead of receiving the password as an argument.
  NELCOTA_ADMIN_PASSWORD="$password" compose exec -T --env NELCOTA_ADMIN_PASSWORD web \
    bun run admin:create --if-missing --email "$email" ||
    fail 'First-admin provisioning failed. Resolve the error above before publishing the panel.'

  start_worker
  start_ingress
  report_panel_ready
}

start_worker() {
  # Initialize the shared routes volume from the worker before Traefik mounts panel.yml in it.
  printf 'Starting the worker.\n'
  compose up --detach --no-build worker ||
    fail "The worker failed to start. Run docker compose --project-directory $install_dir logs worker."
  compose exec -T worker docker info --format '{{.ServerVersion}}' >/dev/null ||
    fail 'The worker cannot access the Docker socket. Check DOCKER_GID and the socket permissions.'
  # The nested bind mount needs a mountpoint before Docker mounts the parent read-only.
  compose exec -T worker sh -c 'test -w /routes && { test -f /routes/panel.yml || touch /routes/panel.yml; }' ||
    fail 'The worker cannot prepare the routes volume. Check its ownership and permissions.'
}

start_ingress() {
  local health_url="https://$domain/api/health" health_response previous_ingress running_ingress probe_status=0
  local public_probe_status=0 attempt
  local -a public_address_options=()

  previous_ingress=$(compose ps --status running -q traefik)
  printf 'Starting Traefik. Waiting for HTTPS.\n'
  compose up --detach --no-build "$@" traefik ||
    fail "Traefik failed to start. Run docker compose --project-directory $install_dir logs traefik."

  running_ingress=$(compose ps --status running -q traefik)
  if [[ -n "$previous_ingress" && "$previous_ingress" == "$running_ingress" ]]; then
    curl --disable --noproxy '*' --resolve "$domain:443:127.0.0.1" --silent --max-time 5 \
      --output /dev/null "$health_url" || probe_status=$?
    if [[ "$probe_status" == "$curl_certificate_error" ]]; then
      # Traefik attempts initial issuance when it receives the router configuration.
      printf 'Restarting Traefik to retry certificate issuance.\n'
      compose restart traefik || fail 'Could not restart Traefik to retry certificate issuance.'
    fi
  fi

  health_response=$(curl --disable --noproxy '*' --resolve "$domain:443:127.0.0.1" --fail --silent --show-error \
    --retry 18 --retry-all-errors --retry-delay 5 --retry-max-time 100 --max-time 5 \
    "$health_url") && [[ "$health_response" == '{"status":"ok"}' ]] ||
    fail "HTTPS is not ready at the local Traefik origin. Check DNS, inbound ports 80 and 443, and docker compose --project-directory $install_dir logs traefik. Then rerun the installer."

  for ((attempt = 1; attempt <= public_health_attempts; attempt++)); do
    public_probe_status=0
    health_response=$(curl --disable "${public_address_options[@]}" --noproxy '*' --fail --silent --show-error \
      --max-time "$public_health_timeout_seconds" "$health_url") || public_probe_status=$?
    if ((attempt == public_health_attempts)); then
      break
    fi

    if ((public_probe_status == curl_timeout_error && ${#public_address_options[@]} == 0)); then
      public_address_options=(--ipv4)
      printf 'Public HTTPS check timed out. Retrying over IPv4 in %s seconds.\n' "$public_health_retry_delay_seconds"
    elif ((${#public_address_options[@]} > 0)) &&
      ((public_probe_status == curl_timeout_error || public_probe_status == curl_resolve_error)); then
      public_address_options=()
      printf 'Public HTTPS check over IPv4 could not reach the host. Retrying with normal DNS resolution in %s seconds.\n' "$public_health_retry_delay_seconds"
    else
      break
    fi

    sleep "$public_health_retry_delay_seconds"
  done

  [[ "$public_probe_status" == 0 && "$health_response" == '{"status":"ok"}' ]] ||
    fail "The origin has HTTPS, but $health_url is unavailable through public DNS from this server. Check DNS, proxy and firewall settings, then rerun."
}

report_panel_ready() {
  printf '\nPanel ready at https://%s\n' "$domain"
  if [[ -f "$password_file" ]]; then
    printf 'Administrator: %s\nRead the initial password: sudo cat %s\nRemove this file after signing in: sudo rm %s\n' \
      "$email" "$password_file" "$password_file"
  fi
}

main() {
  local update=false
  domain=''
  email=''
  installation_id=''
  while (( $# > 0 )); do
    case "$1" in
      --domain|--email)
        [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "$1 requires a value."
        if [[ "$1" == --domain ]]; then
          domain=${2,,}
        else
          email=${2,,}
        fi

        shift 2
        ;;
      --help|-h) usage; return ;;
      --update) update=true; shift ;;
      *) fail "Unknown option: $1. Run bash install.sh --help." ;;
    esac
  done

  [[ "$(uname -s)" == Linux ]] || fail 'Run this installer on the Linux VPS.'
  case "$(uname -m)" in
    x86_64|aarch64) ;;
    *) fail 'Supported architectures are amd64 and arm64.' ;;
  esac
  [[ "$EUID" == 0 ]] || fail 'Run this installer with sudo.'
  [[ -f "$source_dir/docker-compose.yml" && -f "$source_dir/deploy/compose.install.yml" && -f "$source_dir/deploy/traefik/panel.yml" ]] ||
    fail 'Run install.sh from the extracted release bundle or a complete source checkout.'

  [[ ! -L "$install_dir" ]] || fail "$install_dir must be a real directory."
  if [[ ! -d "$install_dir" ]]; then
    install -d -m 0700 "$install_dir"
  fi

  [[ "$(stat -c '%u:%a' "$install_dir")" == 0:700 ]] || fail "$install_dir must belong to root and have mode 0700."
  exec 9< "$install_dir"
  flock -n 9 || fail 'Another Nelcota Deploy installer is running.'

  if [[ "$update" == true ]]; then
    [[ -z "$domain" && -z "$email" ]] || fail '--update uses the installed domain and email.'
    [[ -f "$install_dir/.env" ]] || fail 'No installer-managed installation found. Run install.sh first.'
  elif [[ -L "$install_dir/update-backups/pending" ]]; then
    fail 'An update is pending. Rerun the same release with --update or follow the release recovery instructions.'
  fi

  if [[ ! -f "$install_dir/.env" && ! -t 0 && ( -z "$domain" || -z "$email" ) ]]; then
    usage >&2
    fail 'Pass --domain and --email when running without an interactive terminal.'
  fi

  unset COMPOSE_PROFILES COMPOSE_ENV_FILES COMPOSE_DISABLE_ENV_FILE COMPOSE_REMOVE_ORPHANS
  unset DOCKER_CONTEXT DOCKER_API_VERSION DOCKER_DEFAULT_PLATFORM
  unset PANEL_DOMAIN ACME_EMAIL NELCOTA_INSTALL_ADMIN_EMAIL NELCOTA_INSTALL_ID NELCOTA_IMAGE DOCKER_GID PANEL_CONTROL_ADDRESS PANEL_CONTROL_SUBNET
  ensure_docker

  for tool in curl openssl ss ip getent; do
    command -v "$tool" >/dev/null || fail "Install $tool on the VPS, then rerun."
  done

  if [[ -f "$install_dir/.env" ]]; then
    installation_id=$(awk -F= '$1 == "NELCOTA_INSTALL_ID" {print $2}' "$install_dir/.env")
    [[ "$installation_id" =~ ^[a-f0-9]{32}$ ]] || fail 'The saved installation ID is missing or invalid. Check the installation configuration or restore its backup.'
  fi

  check_docker_resources
  if [[ "$update" == true ]]; then
    [[ -f "$source_dir/deploy/update.sh" ]] || fail 'Extract the complete release bundle before updating.'
    # shellcheck source=deploy/update.sh
    source "$source_dir/deploy/update.sh"
    update_panel
    return
  fi

  check_ports
  configure
  check_docker_resources
  start_panel
}

main "$@"
