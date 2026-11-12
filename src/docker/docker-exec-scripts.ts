// The shell remains the command's parent until completion, so cancellation can reach the
// entire process tree even after the Docker client disconnects. Arguments remain "$@".
export const EXEC_SCRIPT = `
set -f
marker=$1
shift
report_process() {
  IFS= read -r process_stat < /proc/$$/stat || exit 125
  process_fields=\${process_stat##*) }
  set -- $process_fields
  shift 19
  printf '%s %s %s\\n' "$marker" "$$" "$1" >&2
}
report_process
"$@" &
wait "$!"
`;

// Freeze each parent before visiting its children so it cannot spawn more or reap a child
// whose PID could then be reused. Kernels without the children file still expose each PPID.
// https://www.kernel.org/doc/html/latest/filesystems/proc.html
export const STOP_EXEC_SCRIPT = `
root_pid=$1
expected_start=$2
case "$root_pid" in ''|*[!0-9]*|0|1) exit 125;; esac
case "$expected_start" in ''|*[!0-9]*) exit 125;; esac
process_start() (
  IFS= read -r process_stat 2>/dev/null < /proc/"$1"/stat || return 1
  process_fields=\${process_stat##*) }
  set -- $process_fields
  shift 19
  printf '%s' "$1"
)
if started_at=$(process_start "$root_pid"); then
  [ "$started_at" = "$expected_start" ] || exit 0
elif [ -d /proc/"$root_pid" ]; then
  printf 'Cannot verify the container command identity\\n' >&2
  exit 125
else
  exit 0
fi
proc_children() (
  parent=$1
  for stat_file in /proc/[0-9]*/stat; do
    if IFS= read -r process_stat 2>/dev/null < "$stat_file"; then
      process_fields=\${process_stat##*) }
      set -- $process_fields
      if [ "$2" = "$parent" ]; then
        child=\${stat_file%/stat}
        printf '%s\\n' "\${child##*/}"
      fi
    fi
  done
)
stop_tree() {
  if pause_error=$(kill -s STOP "$1" 2>&1); then
    :
  elif [ -d /proc/"$1" ]; then
    if [ "$1" = "$root_pid" ] && started_at=$(process_start "$1") && [ "$started_at" != "$expected_start" ]; then
      return 0
    fi
    printf 'Cannot pause container process %s: %s\\n' "$1" "$pause_error" >&2
    return 125
  else
    return 0
  fi
  if [ "$1" = "$root_pid" ]; then
    if started_at=$(process_start "$1"); then
      if [ "$started_at" != "$expected_start" ]; then
        kill -s CONT "$1" 2>/dev/null
        return 0
      fi
    elif [ -d /proc/"$1" ]; then
      kill -s CONT "$1" 2>/dev/null
      printf 'Cannot verify the paused container command identity\\n' >&2
      return 125
    else
      return 0
    fi
  fi
  if [ -r /proc/"$1"/task/"$1"/children ]; then
    for task_children in /proc/"$1"/task/*/children; do
      children=
      IFS= read -r children < "$task_children" || :
      for child in $children; do
        stop_tree "$child" || return 125
      done
    done
  else
    children=$(proc_children "$1") || return 125
    for child in $children; do
      stop_tree "$child" || return 125
    done
  fi
  if stop_error=$(kill -s KILL "$1" 2>&1); then
    return 0
  fi
  if [ -d /proc/"$1" ]; then
    printf 'Cannot kill container process %s: %s\\n' "$1" "$stop_error" >&2
    return 125
  fi
  return 0
}
stop_tree "$root_pid"
`;
