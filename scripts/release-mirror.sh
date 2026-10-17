#!/usr/bin/env bash
# Publish one signed release directory to a direct HTTPS distribution root.
#
# Usage: MINISIGN_PUBLIC_KEY=... scripts/release-mirror.sh RELEASE_DIR DESTINATION [--no-latest]
#   RELEASE_DIR  dist/vX.Y.Z produced by scripts/release.sh
#   DESTINATION  a local directory, or user@host:/absolute/path reachable with ssh/scp
#                (SSH options such as -i or UserKnownHostsFile come from RELEASE_MIRROR_SSH_OPTS)
#
# Resulting layout, served as https://releases.example.com/nelcota (the release URL root):
#   <root>/<version>/...   every file of the signed release; never overwritten
#   <root>/latest          the newest stable version tag and a newline, at most 64 bytes
# `latest` is an unsigned hint: the panel verifies that version's signed manifest
# before offering or applying it. It only moves forward (sort -V), and pre-release
# tags (containing "-") never update it.
set -euo pipefail
umask 022
fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }
[[ $# == 2 || ($# == 3 && $3 == --no-latest) ]] || fail 'Usage: scripts/release-mirror.sh RELEASE_DIR DESTINATION [--no-latest]'
source_dir=${1%/} destination=$2 update_latest=true
[[ $# == 3 ]] && update_latest=false
version=${source_dir##*/}
[[ $version =~ ^v(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(-[0-9A-Za-z.-]+)?$ ]] || fail "The release directory must be named after its version, not $version"
[[ $version == *-* ]] && update_latest=false
[[ -n ${MINISIGN_PUBLIC_KEY:-} ]] || fail 'MINISIGN_PUBLIC_KEY is required; unverified releases are never published'
command -v minisign >/dev/null 2>&1 || fail 'minisign is required'

# Verify the signature and every listed file before anything leaves this machine.
minisign -Vm "$source_dir/checksums.txt" -x "$source_dir/checksums.txt.minisig" -P "$MINISIGN_PUBLIC_KEY" >/dev/null ||
	fail 'checksums.txt does not verify with MINISIGN_PUBLIC_KEY'
(cd "$source_dir" && sha256sum --check --quiet --strict checksums.txt) || fail 'A release file does not match checksums.txt'
mapfile -t files < <(cd "$source_dir" && find . -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort)
for file in "${files[@]}"; do
	[[ $file == checksums.txt || $file == checksums.txt.minisig ]] && continue
	awk -v f="$file" '$2 == f { found = 1 } END { exit !found }' "$source_dir/checksums.txt" || fail "$file is not covered by checksums.txt"
done
[[ -z $(find "$source_dir" -mindepth 1 ! -type f -print -quit) ]] || fail 'The release directory may contain only regular files'

# Runs on the destination: prepare, finalize, and update `latest`. POSIX sh plus
# GNU coreutils (sort -V), so it works on a typical Linux distribution host.
# shellcheck disable=SC2016 # Expanded by the destination shell.
remote_script='
set -eu
action=$1 root=$2 version=$3
cd "$root"
case $action in
prepare)
	if [ -e "$version" ]; then echo "Release $version already exists; refusing to overwrite" >&2; exit 3; fi
	rm -rf ".incoming-$version"
	mkdir ".incoming-$version"
	;;
finalize)
	(cd ".incoming-$version" && sha256sum --check --quiet --strict checksums.txt)
	chmod 0644 ".incoming-$version"/*
	chmod 0755 ".incoming-$version"
	if [ -e "$version" ]; then echo "Release $version appeared during upload" >&2; exit 3; fi
	mv ".incoming-$version" "$version"
	;;
latest)
	current=$(head -c 64 latest 2>/dev/null | head -n 1 || true)
	case $current in v[0-9]*.[0-9]*.[0-9]*) ;; *) current="" ;; esac
	newest=$(printf "%s\n%s\n" "$current" "$version" | sed "/^$/d" | sort -V | tail -n 1)
	if [ "$newest" != "$version" ] || [ "$current" = "$version" ]; then
		echo "latest stays at ${current:-<none>}"
		exit 0
	fi
	printf "%s\n" "$version" > .latest.tmp
	chmod 0644 .latest.tmp
	mv -f .latest.tmp latest
	echo "latest now points to $version"
	;;
esac'

if [[ $destination =~ ^([A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:(/[A-Za-z0-9._/-]+)$ ]]; then
	host=${destination%%:*} root=${BASH_REMATCH[2]}
	read -r -a ssh_opts <<< "${RELEASE_MIRROR_SSH_OPTS:-}"
	# The script and validated arguments are single-quoted for the remote shell.
	# shellcheck disable=SC2029
	on_destination() { ssh "${ssh_opts[@]}" "$host" "sh -c '${remote_script//\'/\'\\\'\'}' sh $1 '$root' '$version'"; }
	copy() { scp -q "${ssh_opts[@]}" "${files[@]/#/$source_dir/}" "$host:$root/.incoming-$version/"; }
else
	[[ -d $destination ]] || fail "Destination $destination is neither user@host:/path nor an existing directory"
	root=$(cd "$destination" && pwd)
	on_destination() { sh -c "$remote_script" sh "$1" "$root" "$version"; }
	copy() { cp -p -- "${files[@]/#/$source_dir/}" "$root/.incoming-$version/"; }
fi

on_destination prepare
copy
on_destination finalize
printf 'Published %s (%d files)\n' "$version" "${#files[@]}"
if [[ $update_latest == true ]]; then
	on_destination latest
else
	printf 'latest not updated (%s)\n' "$([[ $version == *-* ]] && echo pre-release || echo --no-latest)"
fi
