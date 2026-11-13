#!/usr/bin/env bash
set -euo pipefail

container=$(docker run --rm --detach python:3.15-alpine sleep 120)
trap 'docker rm --force "$container" >/dev/null' EXIT

probe_signals() {
  docker exec --detach "$container" sh -ec 'printf "%s\n" "$$" > /tmp/docker-signal-probe.pid; sleep 30 & wait "$!"' || return 1
  docker exec "$container" sh -ec '
    for attempt in 1 2 3 4 5; do
      if [ -s /tmp/docker-signal-probe.pid ]; then
        break
      fi
      sleep 1
    done
    read -r target < /tmp/docker-signal-probe.pid
    rm /tmp/docker-signal-probe.pid
    if ! kill -s STOP "$target"; then
      cat /proc/self/attr/current >&2
      cat "/proc/$target/attr/current" >&2
      exit 1
    fi
    kill -s CONT "$target"
    kill -s KILL "$target"
  '
}

if failure=$(probe_signals 2>&1); then
  exit 0
fi

printf '%s\n' "$failure" >&2
case "$failure" in
  *'Permission denied'*'docker-default//&unconfined (enforce)'*) ;;
  *) exit 1 ;;
esac

engine_version=$(docker version --format '{{.Server.Version}}')
if [[ "$engine_version" != 28.0.4 ]]; then
  printf 'Review the AppArmor profile for Docker Engine %s before applying the CI fix.\n' "$engine_version" >&2
  exit 1
fi

# Keep the upstream Docker 28.0.4 policy and add the exact stacked peer for signal delivery.
# https://github.com/moby/moby/issues/54099
daemon_pid=$(systemctl show docker.service --property MainPID --value)
if [[ "$daemon_pid" == 0 || -z "$daemon_pid" ]]; then
  printf 'Could not find the Docker daemon PID.\n' >&2
  exit 1
fi

daemon_label=$(sudo cat "/proc/$daemon_pid/attr/current")
daemon_profile=${daemon_label% (*}
profile_source=https://raw.githubusercontent.com/moby/moby/6430e49a55babd9b8f4d08e70ecb2b68900770fe/profiles/apparmor/template.go
profile=$(
  curl -fsSL --retry 3 "$profile_source" |
    awk -v daemon_profile="$daemon_profile" '
      /^const baseTemplate = / { in_template = 1; next }
      !in_template { next }
      /^`$/ { exit }
      /^{{range .*\.Imports}}$/ { print "#include <tunables/global>"; next }
      /^{{range .*\.InnerImports}}$/ { print "  #include <abstractions/base>"; next }
      /^[[:blank:]]*{{[$]/ || /^{{end}}$/ { next }
      {
        gsub(/{{\.Name}}/, "docker-default")
        gsub(/{{\.DaemonProfile}}/, daemon_profile)
        print
        if ($0 == "  signal (send,receive) peer=docker-default,") {
          print "  signal (send,receive) peer=\"docker-default//&unconfined\","
          updated = 1
        }
      }
      END { if (!updated) exit 1 }
    '
)
printf '%s\n' "$profile" | sudo apparmor_parser -Kr

probe_signals
