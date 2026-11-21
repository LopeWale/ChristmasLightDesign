#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER_DIR="$REPO_ROOT/apps/recon-worker"

has_worker_deps() {
  local py="$1"
  [[ -x "$py" ]] || return 1
  "$py" -c "import uvicorn, fastapi, trimesh, cv2, numpy, scipy" >/dev/null 2>&1
}

RESOLVED_PY=""
CANDIDATES=(
  "$WORKER_DIR/.venv/bin/python"
  "$REPO_ROOT/.venv/bin/python"
  "${VIRTUAL_ENV:-}/bin/python"
)

if command -v python3 >/dev/null 2>&1; then
  CANDIDATES+=("$(command -v python3)")
fi

for candidate in "${CANDIDATES[@]}"; do
  if [[ -n "$candidate" ]] && has_worker_deps "$candidate"; then
    RESOLVED_PY="$candidate"
    break
  fi
done

if [[ -z "$RESOLVED_PY" ]]; then
  echo "[lumen3d:worker] Bootstrapping Python virtualenv in apps/recon-worker/.venv ..."
  BOOT_PY=""
  for p in /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3 /usr/local/bin/python3 "$(command -v python3 || true)"; do
    if [[ -n "$p" && -x "$p" ]]; then
      BOOT_PY="$p"
      break
    fi
  done
  if [[ -z "$BOOT_PY" ]]; then
    echo "[lumen3d:worker] ERROR: python3 not found on PATH." >&2
    exit 1
  fi
  "$BOOT_PY" -m venv "$WORKER_DIR/.venv"
  "$WORKER_DIR/.venv/bin/pip" install --upgrade pip >/dev/null
  "$WORKER_DIR/.venv/bin/pip" install -e "$WORKER_DIR"
  RESOLVED_PY="$WORKER_DIR/.venv/bin/python"
fi

if [[ "${1:-}" == "--check-only" ]]; then
  echo "Resolved worker Python: $RESOLVED_PY"
  exit 0
fi

cd "$WORKER_DIR"
exec "$RESOLVED_PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
