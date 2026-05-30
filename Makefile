BIN            := bin/monad-api
API_URL        := http://localhost:8080
API_PORT       := 8080
ANVIL_PORT     := 8545
UI_PORT        := 5173
N_AGENTS       ?= 3    # agent curators for PlaylistBounty
AGENT_INTERVAL ?= 5    # seconds between agent submissions
ORACLE_INTERVAL?= 10   # seconds between oracle scoring ticks
OLLAMA_MODEL   ?= qwen3:1.7b

# Testnet / build knobs — override via env or command line
CONTRACT_ADDRESS ?=
PRIVATE_KEY      ?=
RPC_URL          ?= https://testnet-rpc.monad.xyz
CHAIN_ID         ?= 10143

# Generic deploy knobs — `make deploy-any CONTRACT=Foo ARGS='["0x.."]'`
CONTRACT ?=
ARGS     ?= []

export OLLAMA_MODEL

.PHONY: all start anvil api ui forge-build \
        deploy-playlist setup-playlist loops-playlist playlist \
        playlist-ui playlist-ui-install \
        deploy-testnet build-ui dump-songs \
        deploy-any autoregister \
        stop clean test test-sol test-go

# ── Start API + agent loops (testnet) ─────────────────────────────────────────
start: api loops-playlist ui playlist-ui

# ── PlaylistBounty: full local bootstrap (default) ────────────────────────────
all: clean anvil api forge-build deploy-playlist loops-playlist playlist-ui-install playlist-ui
	@echo ""
	@echo "PlaylistBounty is running."
	@echo "  UI    → http://localhost:5175"
	@echo "  API   → http://localhost:$(API_PORT)"
	@echo "  Anvil → http://localhost:$(ANVIL_PORT)"
	@echo ""
	@echo "Log tails:"
	@echo "  tail -f /tmp/monad-api.log"
	@echo "  tail -f /tmp/loop-oracle.log"
	@for i in $$(seq 1 $(N_AGENTS)); do echo "  tail -f /tmp/loop-agent-$$i.log"; done

# ── Forge build ───────────────────────────────────────────────────────────────
forge-build:
	@echo "Compiling Solidity contracts..."
	@forge build --silent
	@echo "Contracts compiled"

# ── Contract deployment to Monad testnet ──────────────────────────────────────
#
# Usage:
#   PRIVATE_KEY=0x... make deploy-testnet
#   TREASURY_SEED=500000000000000000 PRIVATE_KEY=0x... make deploy-testnet
#
deploy-testnet:
	@test -n "$(PRIVATE_KEY)" || { echo "Set PRIVATE_KEY=0x... (env var or .env)"; exit 1; }
	PRIVATE_KEY=$(PRIVATE_KEY) forge script script/DeployPlaylist.s.sol:DeployPlaylist \
		--rpc-url $(RPC_URL) \
		--broadcast \
		--private-key $(PRIVATE_KEY) \
		-vvv

# ── Static UI build for Monad testnet ─────────────────────────────────────────
#
# 1. Fetches songs from running local API → playlist-ui/public/songs.json
#    (skipped if songs.json already exists — run `make dump-songs` to refresh)
# 2. Compiles React/Vite → playlist-ui/dist/  (static HTML + JS + CSS)
#
# Usage:
#   CONTRACT_ADDRESS=0x... make build-ui
#   CONTRACT_ADDRESS=0x... VITE_RPC_URL=https://testnet-rpc.monad.xyz make build-ui
#
build-ui: playlist-ui/node_modules forge-build
	@test -n "$(CONTRACT_ADDRESS)" || { \
		echo "Set CONTRACT_ADDRESS=0x... (address of deployed PlaylistBounty)"; exit 1; }
	@mkdir -p playlist-ui/public
	@if [ ! -f playlist-ui/public/songs.json ]; then \
		echo "Fetching songs from API (http://localhost:$(API_PORT))..."; \
		curl -sf "http://localhost:$(API_PORT)/songs?limit=9999" > playlist-ui/public/songs.json || \
			{ echo "API not reachable — start it first with 'make api' or run 'make dump-songs'"; exit 1; }; \
		echo "Songs saved → playlist-ui/public/songs.json"; \
	else \
		echo "Using cached songs.json (delete it or run 'make dump-songs' to refresh)"; \
	fi
	@echo "Building playlist-ui (CONTRACT_ADDRESS=$(CONTRACT_ADDRESS))..."
	@cd playlist-ui && \
		VITE_CONTRACT_ADDRESS=$(CONTRACT_ADDRESS) \
		VITE_RPC_URL=$(VITE_RPC_URL) \
		npm run build
	@echo ""
	@echo "Static build ready → playlist-ui/dist/"
	@echo "Deploy the contents of dist/ to any static host (Vercel, S3, Netlify…)"

# Explicitly dump songs from a running API and save for future builds.
# Run this once after seeding the DB; songs.json survives make clean.
dump-songs:
	@echo "Fetching songs from API (http://localhost:$(API_PORT))..."
	@mkdir -p playlist-ui/public
	@curl -sf "http://localhost:$(API_PORT)/songs?limit=9999" > playlist-ui/public/songs.json
	@echo "Saved $$(wc -c < playlist-ui/public/songs.json | tr -d ' ') bytes → playlist-ui/public/songs.json"

# ── PlaylistBounty deploy + setup (local anvil) ───────────────────────────────
deploy-playlist: agent/node_modules forge-build
	@echo "Deploying PlaylistBounty to anvil..."
	@cd agent && npm run deploy:playlist
	@echo "Registering contract, statuses, actions and agents (N_AGENTS=$(N_AGENTS))..."
	@cd agent && API_URL=$(API_URL) N_AGENTS=$(N_AGENTS) npm run setup:playlist

setup-playlist: agent/node_modules
	@cd agent && API_URL=$(API_URL) N_AGENTS=$(N_AGENTS) npm run setup:playlist

# ── PlaylistBounty agent loops (local anvil) ──────────────────────────────────
loops-playlist: agent/node_modules
	@test -f agent/.playlist-agent-ids || { echo "Run 'make deploy-playlist' first"; exit 1; }
	@echo "Starting oracle loop (interval=$(ORACLE_INTERVAL)s)..."
	@ORACLE_ID=$$(grep '^ORACLE_ID=' agent/.playlist-agent-ids | cut -d= -f2); \
	  (cd agent && LOOP_INTERVAL=$(ORACLE_INTERVAL) npm run loop:playlist -- $$ORACLE_ID 0 > /tmp/loop-oracle.log 2>&1) & \
	  echo $$! > /tmp/loop-oracle.pid; \
	  echo "  Oracle agent $$ORACLE_ID  →  /tmp/loop-oracle.log"
	@i=1; while [ $$i -le $(N_AGENTS) ]; do \
	  ID=$$(grep "^AGENT_$${i}_ID=" agent/.playlist-agent-ids | cut -d= -f2); \
	  (cd agent && npm run loop:playlist -- $$ID 0 > /tmp/loop-agent-$$i.log 2>&1) & \
	  echo $$! > /tmp/loop-agent-$$i.pid; \
	  echo "  Agent $$i id=$$ID  →  /tmp/loop-agent-$$i.log"; \
	  i=$$((i+1)); \
	done
	@sleep 3
	@echo "Activating loops via API..."
	@ORACLE_ID=$$(grep '^ORACLE_ID=' agent/.playlist-agent-ids | cut -d= -f2); \
	  curl -sf -X POST $(API_URL)/agents/$$ORACLE_ID/loop/start \
	    -H "Content-Type: application/json" \
	    -d '{"interval":$(ORACLE_INTERVAL)}' > /dev/null && \
	  echo "  Activated oracle_1 (agent $$ORACLE_ID)"
	@i=1; while [ $$i -le $(N_AGENTS) ]; do \
	  ID=$$(grep "^AGENT_$${i}_ID=" agent/.playlist-agent-ids | cut -d= -f2); \
	  curl -sf -X POST $(API_URL)/agents/$$ID/loop/start \
	    -H "Content-Type: application/json" \
	    -d '{"interval":$(AGENT_INTERVAL)}' > /dev/null; \
	  echo "  Activated agent_$$i (agent $$ID)"; \
	  i=$$((i+1)); \
	done
	@echo "All loops started."

# Convenience alias: rebuild + redeploy + restart loops without full clean
playlist: forge-build deploy-playlist loops-playlist

# ── Playlist UI dev server ────────────────────────────────────────────────────
PLAYLIST_UI_PORT := 5175

playlist-ui/node_modules:
	cd playlist-ui && npm install

playlist-ui-install: playlist-ui/node_modules

playlist-ui: playlist-ui/node_modules
	@if lsof -ti:$(PLAYLIST_UI_PORT) > /dev/null 2>&1; then \
		echo "Playlist UI already running on :$(PLAYLIST_UI_PORT)"; \
	else \
		echo "Starting Playlist UI dev server..."; \
		cd playlist-ui && npm run dev > /tmp/playlist-ui.log 2>&1 & \
		sleep 3; \
		echo "Playlist UI ready at http://localhost:$(PLAYLIST_UI_PORT)"; \
	fi

# ── Tests ─────────────────────────────────────────────────────────────────────
test: test-sol test-go
	@echo "All unit tests passed."

test-sol:
	@echo "── forge test ──"
	@forge test

test-go:
	@echo "── go test (API) ──"
	@cd api && go test ./...

# ── Anvil ─────────────────────────────────────────────────────────────────────
anvil:
	@if lsof -ti:$(ANVIL_PORT) > /dev/null 2>&1; then \
		echo "anvil already running on :$(ANVIL_PORT)"; \
	else \
		echo "Starting anvil..."; \
		anvil --block-time 1 > /tmp/anvil.log 2>&1 & \
		sleep 2; \
		echo "Anvil ready"; \
	fi

# ── Go API ────────────────────────────────────────────────────────────────────
$(BIN): $(wildcard api/*.go) api/go.mod
	@mkdir -p bin
	@echo "Building API..."
	@cd api && go build -o ../$(BIN) .

api: $(BIN)
	@if lsof -ti:$(API_PORT) > /dev/null 2>&1; then \
		echo "API already running on :$(API_PORT)"; \
	else \
		echo "Starting API (model=$(OLLAMA_MODEL))..."; \
		OLLAMA_MODEL=$(OLLAMA_MODEL) ./$(BIN) > /tmp/monad-api.log 2>&1 & \
		sleep 1; \
		echo "API ready at $(API_URL)"; \
	fi

# ── Admin UI ──────────────────────────────────────────────────────────────────
ui/node_modules:
	cd ui && npm install

ui: ui/node_modules
	@if lsof -ti:$(UI_PORT) > /dev/null 2>&1; then \
		echo "UI already running on :$(UI_PORT)"; \
	else \
		echo "Starting UI..."; \
		cd ui && npm run dev > /tmp/monad-ui.log 2>&1 & \
		sleep 3; \
		echo "UI ready at http://localhost:$(UI_PORT)"; \
	fi

# ── Generic: deploy + register ANY contract ───────────────────────────────────
# Deploy any Foundry-compiled contract and auto-derive its agent schema from the ABI.
#   make deploy-any CONTRACT=Foo ARGS='["0x.."]'
deploy-any: agent/node_modules
	@if [ -z "$(CONTRACT)" ]; then echo "Set CONTRACT=<Name> (and optional ARGS='[...]')"; exit 1; fi
	@echo "Deploying $(CONTRACT)..."
	@cd agent && API_URL=$(API_URL) npm run deploy:any -- "$(CONTRACT)" '$(ARGS)'
	@echo "Auto-registering $(CONTRACT) agent schema..."
	@cd agent && API_URL=$(API_URL) npm run autoregister -- "$(CONTRACT)"

autoregister: agent/node_modules
	@if [ -z "$(CONTRACT)" ]; then echo "Set CONTRACT=<Name>"; exit 1; fi
	@cd agent && API_URL=$(API_URL) npm run autoregister -- "$(CONTRACT)"

# ── Agent node_modules ────────────────────────────────────────────────────────
agent/node_modules:
	cd agent && npm install

# ── Stop everything ───────────────────────────────────────────────────────────
stop:
	@lsof -ti:$(ANVIL_PORT)      | xargs kill 2>/dev/null && echo "Stopped anvil"       || true
	@lsof -ti:$(API_PORT)        | xargs kill 2>/dev/null && echo "Stopped API"         || true
	@lsof -ti:$(UI_PORT)         | xargs kill 2>/dev/null && echo "Stopped UI"          || true
	@lsof -ti:$(PLAYLIST_UI_PORT)| xargs kill 2>/dev/null && echo "Stopped playlist UI" || true
	@pkill -f "tsx loop.ts"  2>/dev/null && echo "Stopped loops" || true
	@rm -f /tmp/loop-*.pid

# ── Clean (stop + wipe ephemeral state) ──────────────────────────────────────
# NOTE: playlist-ui/public/songs.json is intentionally preserved — it is
#       immutable song data used by `make build-ui` and costly to re-fetch.
#       Delete it manually only if you want to refresh the catalog.
clean: stop
	@rm -f $(BIN)
	@rm -f contracts.db api/contracts.db
	@rm -f agent/playlist-deployments.json agent/.playlist-agent-ids
	@rm -rf playlist-ui/dist
	@echo "Cleaned (songs.json preserved)"
