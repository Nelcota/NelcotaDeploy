#!/usr/bin/env bash
set -euo pipefail
[[ $# == 2 ]] || { printf '%s\n' 'compare-benchmarks.sh BASE CURRENT' >&2; exit 1; }
.tools/benchstat "$1" "$2" | tee /tmp/nelcota-benchstat.txt
# Benchstat só apresenta uma variação percentual quando há significância estatística.
python3 - <<'PY'
import re
from pathlib import Path
text = Path('/tmp/nelcota-benchstat.txt').read_text()
regressions = [line for line in text.splitlines() if '(p=' in line and any(float(v) > 20 for v in re.findall(r'\+([\d.]+)%', line))]
if regressions:
    raise SystemExit('Regressão significativa acima de 20%:\n' + '\n'.join(regressions))
PY
