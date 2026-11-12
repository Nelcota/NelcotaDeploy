readonly update_backup_root="$install_dir/update-backups"
readonly pending_update="$update_backup_root/pending"
readonly -a update_files=(docker-compose.yml docker-compose.override.yml deploy/traefik/panel.yml .env)

finish_update() {
  local status=$?
  trap - EXIT
  if [[ -n "$staged_update" ]]; then
    rm -rf -- "$staged_update"
  fi

  if ((status == 0)); then
    return
  fi

  if [[ -L "$pending_update" ]]; then
    printf 'Update incomplete. Backup: %s\nRerun this release with --update or follow the recovery instructions in the release README.\n' "$update_backup" >&2
  elif [[ -n "$update_backup" ]]; then
    rm -rf -- "$update_backup"
    if [[ "$services_stopped" == true ]]; then
      printf 'Could not finish the backup. Starting the existing panel and worker.\n' >&2
      compose start web worker ||
        printf 'Could not restart the existing services. Check Docker Compose logs.\n' >&2
    fi
  fi

  exit "$status"
}

backup_before_update() {
  local next_image=$1 relative_path
  update_backup=$(mktemp -d "$update_backup_root/$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX")
  install -d -m 0700 "$update_backup/deploy/traefik"
  for relative_path in "${update_files[@]}"; do
    install -m 0600 "$install_dir/$relative_path" "$update_backup/$relative_path"
  done

  printf '%s\n' "$next_image" > "$update_backup/target-image"
  printf 'Stopping the panel and worker to back up SQLite.\n'
  services_stopped=true
  compose stop web worker || fail 'Could not stop the panel and worker for the backup.'

  # Keep the snapshot in the container until SQLite finishes, then stream it to a private host file.
  docker_local run --rm --pull=never --network none \
    --mount type=volume,source=nelcota_data,target=/data --entrypoint sh "$image" -ec '
      bun -e '\''import { Database } from "bun:sqlite";
        using database = new Database("/data/nelcota.db", { readonly: true });
        database.run("VACUUM INTO ?", ["/tmp/nelcota-backup.db"]);'\''
      exec cat /tmp/nelcota-backup.db
    ' > "$update_backup/nelcota.db" || fail 'Could not back up the panel SQLite database.'
  [[ -s "$update_backup/nelcota.db" ]] || fail 'The panel SQLite backup is empty.'

  # Publish the recovery point before changing any installed files or starting migrations.
  ln -s -- "${update_backup##*/}" "$pending_update"
  printf 'Pre-update backup saved in %s\n' "$update_backup"
}

update_panel() (
  local image next_image relative_path configuration_directory=$install_dir
  local update_backup='' staged_update='' services_stopped=false
  local -a ingress_options=()

  [[ -f "$source_dir/deploy/release-image" ]] || fail '--update requires an official release bundle.'
  next_image=$(< "$source_dir/deploy/release-image")
  [[ "$next_image" =~ $release_image_pattern ]] || fail 'The release bundle has an invalid image digest.'
  install -d -m 0700 "$update_backup_root"
  trap finish_update EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if [[ -L "$pending_update" ]]; then
    update_backup=$(readlink -f -- "$pending_update")
    [[ "$update_backup" == "$update_backup_root/"* && -s "$update_backup/nelcota.db" && -f "$update_backup/target-image" ]] ||
      fail 'The pending update backup is incomplete. Check the recovery directory.'
    [[ "$next_image" == "$(< "$update_backup/target-image")" ]] ||
      fail 'An update to a different release is pending. Complete it or restore its backup before updating.'
    configuration_directory=$update_backup
  else
    check_ports
  fi

  read_saved_configuration "$configuration_directory"
  [[ "$image" =~ $release_image_pattern || "$image" == nelcota-deploy:local ]] ||
    fail 'The installed image reference is invalid.'
  check_panel_address

  staged_update=$(mktemp -d "$update_backup_root/.stage.XXXXXXXX")
  copy_release_files "$staged_update"
  awk -v image="$next_image" '
    /^NELCOTA_IMAGE=/ { print "NELCOTA_IMAGE=" image; count++; next }
    { print }
    END { if (count != 1) exit 1 }
  ' "$configuration_directory/.env" > "$staged_update/.env" || fail 'Expected one NELCOTA_IMAGE entry in the installed .env file.'

  if [[ -z "$update_backup" ]] && cmp -s "$staged_update/.env" "$install_dir/.env" &&
    cmp -s "$staged_update/docker-compose.yml" "$install_dir/docker-compose.yml" &&
    cmp -s "$staged_update/docker-compose.override.yml" "$install_dir/docker-compose.override.yml" &&
    cmp -s "$staged_update/deploy/traefik/panel.yml" "$install_dir/deploy/traefik/panel.yml"; then
    printf 'This release is already installed.\n'
    return
  fi

  compose_from "$staged_update" config --quiet || fail 'The release Compose configuration is invalid.'
  printf 'Downloading release images.\n'
  compose_from "$staged_update" pull web traefik || fail 'Could not download the release images.'
  if [[ -z "$update_backup" ]]; then
    docker_local image inspect "$image" >/dev/null || fail 'The installed image is required to back up SQLite.'
    docker_local volume inspect nelcota_data >/dev/null || fail 'The panel data volume is missing.'
    backup_before_update "$next_image"
  else
    printf 'Resuming update with backup %s\n' "$update_backup"
    compose_from "$update_backup" stop web worker || fail 'Could not stop the panel and worker to resume the update.'
  fi

  # An atomic replacement changes the inode behind Traefik's file bind mount.
  cmp -s "$staged_update/deploy/traefik/panel.yml" "$update_backup/deploy/traefik/panel.yml" ||
    ingress_options+=(--force-recreate)

  for relative_path in "${update_files[@]}"; do
    if cmp -s "$staged_update/$relative_path" "$install_dir/$relative_path"; then
      continue
    fi

    mv -T -- "$staged_update/$relative_path" "$install_dir/$relative_path"
  done

  start_web
  start_ingress "${ingress_options[@]}"
  start_worker
  rm -- "$pending_update"
  report_panel_ready
  printf 'Update complete. Pre-update backup: %s\n' "$update_backup"
)
