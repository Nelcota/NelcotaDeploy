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

// /proc/.../children lists direct children. Freeze each parent before visiting its children
// so it cannot spawn more or reap a child whose PID could then be reused.
// https://www.kernel.org/doc/html/latest/filesystems/proc.html
export const STOP_EXEC_SCRIPT = `
root_pid=$1
expected_start=$2
case "$root_pid" in ''|*[!0-9]*|0|1) exit 125;; esac
case "$expected_start" in ''|*[!0-9]*) exit 125;; esac
if kill -STOP "$root_pid" 2>/dev/null; then
  :
elif [ -d /proc/"$root_pid" ]; then
  printf 'Cannot pause container command\\n' >&2
  exit 125
else
  exit 0
fi
if IFS= read -r process_stat < /proc/"$root_pid"/stat; then
  :
else
  kill -CONT "$root_pid" 2>/dev/null
  exit 125
fi
process_fields=\${process_stat##*) }
set -- $process_fields
shift 19
if [ "$1" != "$expected_start" ]; then
  kill -CONT "$root_pid" 2>/dev/null
  exit 0
fi
stop_tree() {
  if kill -STOP "$1" 2>/dev/null; then
    :
  elif [ -d /proc/"$1" ]; then
    printf 'Cannot pause a command descendant\\n' >&2
    return 125
  else
    return 0
  fi
  if [ -r /proc/"$1"/task/"$1"/children ]; then
    for task_children in /proc/"$1"/task/*/children; do
      children=
      IFS= read -r children < "$task_children" || :
      for child in $children; do
        stop_tree "$child" || return 125
      done
    done
    if kill -KILL "$1" 2>/dev/null; then
      return 0
    fi
    if [ -d /proc/"$1" ]; then
      printf 'Cannot kill a command descendant\\n' >&2
      return 125
    fi
    return 0
  fi
  kill -CONT "$1" 2>/dev/null
  printf 'Cannot enumerate command descendants\\n' >&2
  return 125
}
stop_tree "$root_pid"
`;
