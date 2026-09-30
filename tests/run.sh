#!/usr/bin/env bash
# tests/run.sh — A298 · run every suite and exit non-zero if any of them fails.
#
#   bash tests/run.sh          all JS and Python suites
#   bash tests/run.sh --js     the node suites only (tests/flow/*.js, tests/audit/*.js)
#   bash tests/run.sh --py     the Python suites only (tests/flow/*.py, tests/audit/*.py, via ./venv/bin/python)
#
# Library files (loaders, harnesses, fixtures) are skipped: they define helpers and print nothing.
# Each suite's own output is shown only when it fails, so a green run is one line per suite.
set -u
cd "$(dirname "$0")/.." || exit 2

MODE="${1:-all}"
PY="${PYTHON:-./venv/bin/python}"
SKIP_JS='gasload-code.js gasload.js pageload.js prwload.js qwload.js'
SKIP_PY='quo_fixtures.py trav_fixtures.py'

fail=()
pass=0
start=$(date +%s)

run_one() {   # $1 = runner, $2 = file
  local out
  if out=$("$1" "$2" 2>&1); then
    pass=$((pass + 1)); printf '  ok   %s\n' "$2"
  else
    fail+=("$2"); printf '  FAIL %s\n%s\n' "$2" "$(printf '%s\n' "$out" | tail -25 | sed 's/^/       /')"
  fi
}

if [ "$MODE" = all ] || [ "$MODE" = --js ]; then
  for f in tests/flow/*.js tests/audit/*.js; do
    case " $SKIP_JS " in *" $(basename "$f") "*) continue;; esac
    run_one node "$f"
  done
fi

if [ "$MODE" = all ] || [ "$MODE" = --py ]; then
  if [ ! -x "$PY" ]; then
    echo "  skip python suites: $PY not found (set PYTHON=...)"
  else
    for f in tests/flow/*.py tests/audit/*.py; do
      case " $SKIP_PY " in *" $(basename "$f") "*) continue;; esac
      run_one "$PY" "$f"
    done
  fi
fi

echo
echo "$pass passed, ${#fail[@]} failed, $(( $(date +%s) - start ))s"
if [ "${#fail[@]}" -gt 0 ]; then
  printf '  failed: %s\n' "${fail[@]}"
  exit 1
fi
