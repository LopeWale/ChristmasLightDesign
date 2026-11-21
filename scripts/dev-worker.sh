#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER_DIR="$REPO_ROOT/apps/recon-worker"

has_worker_deps() {
  local py="$1"
  [[ -x "$py" ]] || return 1
  "$py" -c "import uvicorn, fastapi, trimesh, cv2, numpy, scipy, PIL" >/dev/null 2>&1
}

RESOLVED_PY=""

# 1. Prefer dedicated isolated worker venv first so external ML/GUI packages in root .venv cannot conflict
if [[ -n "${LUMEN3D_PYTHON_BIN:-}" ]] && has_worker_deps "$LUMEN3D_PYTHON_BIN"; then
  RESOLVED_PY="$LUMEN3D_PYTHON_BIN"
elif has_worker_deps "$WORKER_DIR/.venv/bin/python"; then
  RESOLVED_PY="$WORKER_DIR/.venv/bin/python"
fi

# 2. Bootstrap dedicated apps/recon-worker/.venv if missing; fall back to existing Python if offline
if [[ -z "$RESOLVED_PY" ]]; then
  FALLBACK_PY=""
  for candidate in "$REPO_ROOT/.venv/bin/python" "${VIRTUAL_ENV:-}/bin/python" "$(command -v python3 || true)"; do
    if [[ -n "$candidate" ]] && has_worker_deps "$candidate"; then
      FALLBACK_PY="$candidate"
      break
    fi
  done

  if [[ "${1:-}" == "--check-only" && -n "$FALLBACK_PY" ]]; then
    RESOLVED_PY="$FALLBACK_PY"
  else
    echo "[lumen3d:worker] Bootstrapping dedicated Python virtualenv in apps/recon-worker/.venv ..."
    BOOT_PY=""
    for p in /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3 /usr/local/bin/python3 "$(command -v python3 || true)"; do
      if [[ -n "$p" && -x "$p" ]]; then
        BOOT_PY="$p"
        break
      fi
    done
    if [[ -z "$BOOT_PY" ]]; then
      if [[ -n "$FALLBACK_PY" ]]; then
        RESOLVED_PY="$FALLBACK_PY"
      else
        echo "[lumen3d:worker] ERROR: python3 not found on PATH." >&2
        exit 1
      fi
    elif "$BOOT_PY" -m venv "$WORKER_DIR/.venv" && \
         "$WORKER_DIR/.venv/bin/pip" install --upgrade pip >/dev/null && \
         "$WORKER_DIR/.venv/bin/pip" install -e "$WORKER_DIR"; then
      RESOLVED_PY="$WORKER_DIR/.venv/bin/python"
    elif [[ -n "$FALLBACK_PY" ]]; then
      RESOLVED_PY="$FALLBACK_PY"
    else
      echo "[lumen3d:worker] ERROR: Failed to bootstrap apps/recon-worker/.venv." >&2
      exit 1
    fi
  fi
fi

if [[ "${1:-}" == "--check-only" ]]; then
  echo "Resolved worker Python: $RESOLVED_PY"
  exit 0
fi

# Prevent OpenMP / Accelerate / BLAS / HuggingFace thread deadlocks inside ThreadPoolExecutor on macOS
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export VECLIB_MAXIMUM_THREADS=1
export MKL_NUM_THREADS=1
export TOKENIZERS_PARALLELISM=false
export HF_HUB_DISABLE_TELEMETRY=1

cd "$WORKER_DIR"
exec "$RESOLVED_PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload --reload-dir app
