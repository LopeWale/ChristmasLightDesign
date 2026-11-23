#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER_DIR="$REPO_ROOT/apps/recon-worker"

bash "$SCRIPT_DIR/dev-worker.sh" --check-only >/dev/null

PY="$WORKER_DIR/.venv/bin/python"
PIP="$WORKER_DIR/.venv/bin/pip"

if [[ ! -x "$PY" ]]; then
  echo "[lumen3d:neural] Bootstrapping apps/recon-worker/.venv first..."
  python3 -m venv "$WORKER_DIR/.venv"
  "$PIP" install --upgrade pip
  "$PIP" install -e "$WORKER_DIR"
fi

echo "[lumen3d:neural] Installing PyTorch (MPS/CUDA), MoGe-2 (MIT), and Depth-Anything-3 (Apache-2.0)..."
"$PIP" install torch torchvision huggingface_hub safetensors einops omegaconf
"$PIP" install --no-deps "git+https://github.com/EasternJournalist/utils3d-moge.git"
"$PIP" install --no-deps "git+https://github.com/microsoft/MoGe.git"
"$PIP" install --no-deps "git+https://github.com/ByteDance-Seed/Depth-Anything-3.git"

echo "[lumen3d:neural] Pre-caching Ruicheng/moge-2-vits-normal (140.6 MB) and depth-anything/DA3-SMALL (137.2 MB)..."
"$PY" -c '
from huggingface_hub import hf_hub_download
hf_hub_download(repo_id="Ruicheng/moge-2-vits-normal", filename="model.pt")
hf_hub_download(repo_id="depth-anything/DA3-SMALL", filename="config.json")
hf_hub_download(repo_id="depth-anything/DA3-SMALL", filename="model.safetensors")
print("[lumen3d:neural] Checkpoints cached and ready for real-time scanning!")
'
