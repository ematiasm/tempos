#!/usr/bin/env bash
# Deploy tempos to a DO VPS over SSH.
#
# Prereqs on the server: docker + compose plugin, a DNS A record for the
# domain (and api./dashboard. subdomains), and this repository cloned with a
# filled-in .env (see docs/DEPLOY.md and .env.production.example).
#
# Usage:
#   scripts/deploy.sh [USER@HOST] [ENV_FILE]
#
# Examples:
#   scripts/deploy.sh root@123.45.67.89
#   scripts/deploy.sh deploy@my-vps .env.production
#
# It uploads the env file (default: .env.production, fallback .env), then on
# the server: pulls latest, builds, and recreates the stack with zero downtime
# (new containers start before old ones are removed).

set -euo pipefail

HOST="${1:-}"
ENV_FILE="${2:-}"
REMOTE_DIR="/opt/${STACK_NAME:-tempos}"

if [[ -z "$HOST" ]]; then
  echo "Usage: $0 [USER@HOST] [ENV_FILE]" >&2
  exit 1
fi

if [[ -z "$ENV_FILE" ]]; then
  if [[ -f ".env.production" ]]; then
    ENV_FILE=".env.production"
  elif [[ -f ".env" ]]; then
    ENV_FILE=".env"
  else
    echo "No env file found (.env.production or .env). See .env.production.example." >&2
    exit 1
  fi
fi

echo "==> Deploying to $HOST (env: $ENV_FILE, dir: $REMOTE_DIR)"

# Ensure the repo exists on the server (clone on first deploy).
ssh "$HOST" bash -s -- "$REMOTE_DIR" <<'EOF'
set -euo pipefail
dir="$1"
if [[ ! -d "$dir/.git" ]]; then
  mkdir -p "$dir"
  git clone https://github.com/your-org/tempos.git "$dir"
fi
EOF

# Sync the env file and the latest code.
scp "$ENV_FILE" "$HOST:$REMOTE_DIR/.env"
git push origin HEAD 2>/dev/null || true
ssh "$HOST" bash -s -- "$REMOTE_DIR" <<'EOF'
set -euo pipefail
cd "$1"
git fetch origin && git reset --hard origin/master
STACK_NAME="$(grep '^STACK_NAME=' .env | cut -d= -f2- || echo tempos)"
DOMAIN="$(grep '^DOMAIN=' .env | cut -d= -f2-)"
docker compose -f compose.yml --project-name "$STACK_NAME" build
docker compose -f compose.yml --project-name "$STACK_NAME" up -d --remove-orphans
docker image prune -f
echo "==> Deployed. Frontend: https://dashboard.$DOMAIN  API: https://api.$DOMAIN"
EOF

echo "==> Done."
