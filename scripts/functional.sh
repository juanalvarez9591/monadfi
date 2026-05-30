#!/usr/bin/env bash
#
# functional.sh — self-contained, deterministic end-to-end test of the
# House Roulette + MonadToken use case, driven through the agent execution schema.
#
# Brings up a clean stack (instamine anvil + API + warm Ollama model), deploys the
# contracts, registers the agent schema, funds a player, then plays one full round
# by ticking the real House and Player agents. Asserts the player wins and is paid.
#
# Usage:  scripts/functional.sh
# Env:    OLLAMA_MODEL (default qwen3:1.7b), ANVIL_PORT (8545), API_PORT (8080)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ANVIL_PORT="${ANVIL_PORT:-8545}"
API_PORT="${API_PORT:-8080}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3:1.7b}"
API_URL="http://localhost:${API_PORT}"
export API_URL OLLAMA_MODEL

log() { printf '\033[36m▸ %s\033[0m\n' "$*"; }

cleanup() {
  [ -n "${ANVIL_PID:-}" ] && kill "$ANVIL_PID" 2>/dev/null || true
  [ -n "${API_PID:-}" ]   && kill "$API_PID"   2>/dev/null || true
}
trap cleanup EXIT

# ── Clean slate ───────────────────────────────────────────────────────────────
log "Cleaning previous state"
lsof -ti:"$ANVIL_PORT" | xargs kill 2>/dev/null || true
lsof -ti:"$API_PORT"   | xargs kill 2>/dev/null || true
rm -f contracts.db api/contracts.db agent/deployments.json agent/.agent-ids
sleep 1

# ── Build ───────────────────────────────────────────────────────────────────--
log "Building contracts + API"
forge build >/tmp/functional-forge.log 2>&1
( cd api && go build -o ../bin/monad-api . )

# ── Anvil (instamine → deterministic, instant blocks) ───────────────────────---
log "Starting anvil (instamine) on :$ANVIL_PORT"
anvil --port "$ANVIL_PORT" >/tmp/functional-anvil.log 2>&1 &
ANVIL_PID=$!
sleep 2

# ── API ─────────────────────────────────────────────────────────────────────--
log "Starting API on :$API_PORT (model=$OLLAMA_MODEL)"
PORT="$API_PORT" ./bin/monad-api >/tmp/functional-api.log 2>&1 &
API_PID=$!
sleep 2

# ── Warm the model (so inference is fast and the round is quick) ──────────────--
log "Warming Ollama model $OLLAMA_MODEL"
curl -s http://localhost:11434/api/chat \
  -d "{\"model\":\"$OLLAMA_MODEL\",\"keep_alive\":\"30m\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false,\"think\":false,\"options\":{\"num_predict\":1}}" \
  >/dev/null || { echo "Ollama not reachable on :11434"; exit 1; }

# ── Deploy → register → fund → play ───────────────────────────────────────────
cd agent
log "Deploying MonadToken + CasinoRoulette"
npm run deploy --silent
log "Registering agent schema (House + Player)"
npm run setup --silent
log "Funding 1 player wallet"
npm run fund --silent -- 1
log "Playing one round through the agents"
npm run functional --silent
