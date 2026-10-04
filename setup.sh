#!/usr/bin/env bash
# Create this harness's own venv and check everything a run actually needs.
#
# The driver used to borrow ~/ui-long-degradation-test/.venv. That worked and was wrong: this
# repo's runs would silently change meaning whenever that harness's dependencies moved, and a
# fresh clone had no way to know it needed someone else's venv at all.
#
# What this does NOT install, because it cannot:
#   - the erosion harness itself (~/ui-long-degradation-test). Its correctness/agent/landlock
#     modules ARE the gate runner and the confinement, imported by path rather than vendored so
#     a fix lands once (DESIGN.md §9). Checked below.
#   - the JDK/Maven/Node toolchain the application builds with. The harness never looks inside
#     bin/build; it just has to succeed. Checked below.
#   - the stack's own Playwright + browser, which its bin/e2e installs from its pinned lockfile
#     on the first gate run.
set -euo pipefail
cd "$(dirname "$0")"

echo "== venv =="
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
echo "   .venv ready: $(.venv/bin/python -V)"
.venv/bin/pip list 2>/dev/null | grep -iE "^(PyYAML|lizard) " | sed 's/^/   /'

echo
echo "== prerequisites =="
ok=1
note() { printf '   %-10s %s\n' "$1" "$2"; }
bad()  { printf '   %-10s %s\n' "$1" "$2"; ok=0; }

# the erosion harness: the modules this harness imports rather than copies
HARNESS="${EROSION_HARNESS:-$HOME/ui-long-degradation-test}"
if [ -d "$HARNESS/harness" ]; then
  missing=""
  for m in correctness.py agent.py landlock.py capture.py metrics.py; do
    [ -f "$HARNESS/harness/$m" ] || missing="$missing $m"
  done
  if [ -z "$missing" ]; then
    note "harness" "OK   $HARNESS (correctness, agent, landlock, capture, metrics)"
  else
    bad "harness" "INCOMPLETE $HARNESS — missing:$missing"
  fi
else
  bad "harness" "MISSING  expected the erosion harness at $HARNESS
              It supplies the gate runner and the Landlock confinement. Clone it, or set
              EROSION_HARNESS and config.yaml's erosion_harness to where it lives."
fi
# ... and that it imports cleanly under OUR interpreter, which is the thing that actually breaks
if [ -d "$HARNESS/harness" ]; then
  if PYTHONPATH="$HARNESS" .venv/bin/python -c \
      "from harness import correctness, agent, landlock" >/dev/null 2>&1; then
    note "" "     imports cleanly under this venv"
  else
    bad "" "     DOES NOT import under this venv:"
    PYTHONPATH="$HARNESS" .venv/bin/python -c \
      "from harness import correctness, agent, landlock" 2>&1 | tail -3 | sed 's/^/              /'
  fi
fi

# the application's build/run toolchain — needed by every gate, in either mode
for tool in java mvn node npm; do
  if command -v "$tool" >/dev/null; then
    note "$tool" "OK   $($tool --version 2>&1 | head -1)"
  else
    bad "$tool" "MISSING — bin/build or bin/e2e will fail"
  fi
done
command -v fuser >/dev/null \
  && note "fuser" "OK   (frees a stale port before serving)" \
  || bad "fuser" "MISSING — install psmisc; a leftover JVM would be gated against"

# Landlock: agent mode refuses to run without it (DESIGN.md §7)
abi=$(PYTHONPATH="$HARNESS" .venv/bin/python -c \
      "from harness import landlock; print(landlock.abi_version())" 2>/dev/null || echo 0)
if [ "$abi" -ge 1 ]; then
  note "landlock" "OK   ABI $abi — agent mode can confine the turn"
else
  note "landlock" "UNAVAILABLE — replay mode is fine; AGENT MODE WILL REFUSE TO RUN,
              because withholding the answers is the confinement here (DESIGN.md §7)."
fi

# the fixture
if [ -d reference/base ] && [ -f reference/manifest.yaml ]; then
  n=$(ls reference/cp*.patch 2>/dev/null | wc -l)
  note "reference" "OK   $n checkpoint patch(es) imported"
else
  bad "reference" "NOT IMPORTED — run:
              .venv/bin/python tools/reference.py import --repo <stack> --branch <chain>"
fi
[ -d contracts ] && [ -n "$(ls contracts 2>/dev/null)" ] \
  && note "contracts" "OK   $(ls contracts | wc -l) checkpoint contract(s)" \
  || bad "contracts" "NOT BUILT — run: .venv/bin/python tools/contract.py build"

# agent mode only: a run spawns an agent per checkpoint over hours
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  note "token" "OK   CLAUDE_CODE_OAUTH_TOKEN is set (agent mode)"
else
  note "token" "not set — replay mode is fine. For agent mode:
              export CLAUDE_CODE_OAUTH_TOKEN=\$(claude setup-token)"
fi

echo
if [ "$ok" = 1 ]; then
  echo "Ready. Next, cheapest first:"
  echo "  .venv/bin/python tools/reference.py verify"
  echo "  .venv/bin/python tools/contract.py check"
  echo "  .venv/bin/python -m fidelity.run --mode replay --dry-run"
  echo "  .venv/bin/python -m fidelity.run --mode replay --from 1 --to 8"
else
  echo "Not ready — see the failures above." >&2
  exit 1
fi
