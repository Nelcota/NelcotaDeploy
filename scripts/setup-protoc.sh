#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
destination="$repo/.tools"
if [[ -x "$destination/protoc" ]] && [[ "$("$destination/protoc" --version)" == 'libprotoc 36.1' ]]; then exit 0; fi
case "$(uname -sm)" in
  'Linux x86_64') archive=protoc-36.1-linux-x86_64.zip; digest=c4bc672d9d49214dc8cafdceadf4df92182d6ca8e3ec65a56b2d7de5602669b4 ;;
  'Linux aarch64') archive=protoc-36.1-linux-aarch_64.zip; digest=237a68856edf1bd28b6204bddd0596c1cf46d298bc29c620012540b2e44c73e7 ;;
  *) echo 'protoc setup requires Linux amd64 or arm64.' >&2; exit 1 ;;
esac
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
curl --fail --silent --show-error --location --retry 2 \
  "https://github.com/protocolbuffers/protobuf/releases/download/v36.1/$archive" -o "$scratch/$archive"
printf '%s  %s\n' "$digest" "$scratch/$archive" | sha256sum --check -
mkdir -p "$destination"
python3 - "$scratch/$archive" "$destination" <<'PY'
from pathlib import Path
from zipfile import ZipFile
import sys
target = Path(sys.argv[2])
with ZipFile(sys.argv[1]) as archive:
    for entry in archive.namelist():
        if entry == 'bin/protoc':
            (target/'protoc').write_bytes(archive.read(entry))
        elif entry.startswith('include/') and not entry.endswith('/'):
            output = target/entry
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(archive.read(entry))
(target/'protoc').chmod(0o755)
PY
