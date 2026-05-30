BIN            := bin/monad-api
API_URL        := http://localhost:8080
API_PORT       := 8080
ANVIL_PORT     := 8545
UI_PORT        := 5173
DAPP_PORT      := 5174
N_PLAYERS      ?= 2    # parallel player agents for the casino use-case
N_AGENTS       ?= 3    # agent curators for PlaylistBounty
AGENT_INTERVAL ?= 5    # seconds between agent submissions
ORACLE_INTERVAL?= 10   # seconds between oracle scoring ticks
OLLAMA_MODEL   ?= qwen3:1.7b

# Generic deploy knobs — `make deploy-any CONTRACT=Foo ARGS='["0x.."]'`
CONTRACT ?=
ARGS     ?= []

export OLLAMA_MODEL

.PHONY: all anvil api ui dapp deploy fund loops stop clean test test-sol test-go \
        functional deploy-any autoregister forge-build \
        deploy-playlist setup-playlist loops-playlist playlist \
        playlist-ui playlist-ui-install

# ── PlaylistBounty: full bootstrap (default) ──────────────────────────────────
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

# ── PlaylistBounty deploy + setup ─────────────────────────────────────────────
deploy-playlist: agent/node_modules forge-build
	@echo "Deploying PlaylistBounty to anvil..."
	@cd agent && npm run deploy:playlist
	@echo "Registering contract, statuses, actions and agents (N_AGENTS=$(N_AGENTS))..."
	@cd agent && API_URL=$(API_URL) N_AGENTS=$(N_AGENTS) npm run setup:playlist

setup-playlist: agent/node_modules
	@cd agent && API_URL=$(API_URL) N_AGENTS=$(N_AGENTS) npm run setup:playlist

# ── PlaylistBounty agent loops ────────────────────────────────────────────────
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

# ── Playlist UI ───────────────────────────────────────────────────────────────
PLAYLIST_UI_PORT := 5175

playlist-ui/node_modules:
	cd playlist-ui && npm install

playlist-ui-install: playlist-ui/node_modules

playlist-ui: playlist-ui/node_modules
	@if lsof -ti:$(PLAYLIST_UI_PORT) > /dev/null 2>&1; then \
		echo "Playlist UI already running on :$(PLAYLIST_UI_PORT)"; \
	else \
		echo "Starting Playlist UI..."; \
		cd playlist-ui && npm run dev > /tmp/playlist-ui.log 2>&1 & \
		sleep 3; \
		echo "Playlist UI ready at http://localhost:$(PLAYLIST_UI_PORT)"; \
	fi

# Convenience alias: rebuild + redeploy + restart loops without full clean
playlist: forge-build deploy-playlist loops-playlist

# ── Tests ─────────────────────────────────────────────────────────────────────
# Contract unit tests + Go API unit tests + the deterministic agent functional test.
test: test-sol test-go
	@echo "Unit tests passed. Run 'make functional' for the end-to-end agent round."

test-sol:
	@echo "── forge test ──"
	@forge test

test-go:
	@echo "── go test (API) ──"
	@cd api && go test ./...

# Deterministic end-to-end round driven through the agent execution schema.
# Self-contained: brings up its own anvil + API, requires Ollama running on :11434.
functional:
	@OLLAMA_MODEL=$(OLLAMA_MODEL) bash scripts/functional.sh

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

# ── Player dApp ───────────────────────────────────────────────────────────────
dapp/node_modules:
	cd dapp && npm install

dapp: dapp/node_modules
	@if lsof -ti:$(DAPP_PORT) > /dev/null 2>&1; then \
		echo "dApp already running on :$(DAPP_PORT)"; \
	else \
		echo "Starting player dApp..."; \
		cd dapp && npm run dev > /tmp/monad-dapp.log 2>&1 & \
		sleep 3; \
		echo "dApp ready at http://localhost:$(DAPP_PORT)"; \
	fi

# ── Deploy contracts + register everything (CasinoRoulette use case) ──────────
agent/node_modules:
	cd agent && npm install

deploy: agent/node_modules
	@echo "Deploying contracts to anvil..."
	@cd agent && npm run deploy
	@echo "Registering contracts, statuses, actions and agents..."
	@cd agent && API_URL=$(API_URL) npm run setup

# ── Generic: deploy + register ANY contract ───────────────────────────────────
# Deploy any Foundry-compiled contract and auto-derive its agent schema from the ABI.
#   make deploy-any CONTRACT=MonadToken ARGS='["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"]'
deploy-any: agent/node_modules
	@if [ -z "$(CONTRACT)" ]; then echo "Set CONTRACT=<Name> (and optional ARGS='[...]')"; exit 1; fi
	@echo "Deploying $(CONTRACT)..."
	@cd agent && API_URL=$(API_URL) npm run deploy:any -- "$(CONTRACT)" '$(ARGS)'
	@echo "Auto-registering $(CONTRACT) agent schema..."
	@cd agent && API_URL=$(API_URL) npm run autoregister -- "$(CONTRACT)"

autoregister: agent/node_modules
	@if [ -z "$(CONTRACT)" ]; then echo "Set CONTRACT=<Name>"; exit 1; fi
	@cd agent && API_URL=$(API_URL) npm run autoregister -- "$(CONTRACT)"

# ── Fund player wallets ───────────────────────────────────────────────────────
fund: agent/node_modules
	@echo "Funding $(N_PLAYERS) player wallets with ETH + MTKN + approval..."
	@cd agent && npm run fund -- $(N_PLAYERS)

# ── Start agent loops ─────────────────────────────────────────────────────────
loops: agent/node_modules agent/.agent-ids
	$(eval HOUSE_ID   := $(shell grep HOUSE_ID  agent/.agent-ids | cut -d= -f2))
	$(eval PLAYER_ID  := $(shell grep PLAYER_ID agent/.agent-ids | cut -d= -f2))
	@echo "Starting house loop  (agent $(HOUSE_ID), anvil wallet 0 = owner)..."
	@cd agent && npm run loop -- $(HOUSE_ID) 0 anvil > /tmp/loop-house.log 2>&1 & echo $$! > /tmp/loop-house.pid
	@n=0; while [ $$n -lt $(N_PLAYERS) ]; do \
		echo "Starting player loop $$n (agent $(PLAYER_ID), wallet $$n)..."; \
		(cd agent && npm run loop -- $(PLAYER_ID) $$n > /tmp/loop-player-$$n.log 2>&1) & echo $$! > /tmp/loop-player-$$n.pid; \
		n=$$((n+1)); \
	done
	@sleep 3
	@HOUSE_ID=$$(grep HOUSE_ID agent/.agent-ids | cut -d= -f2); \
	  curl -s -X POST $(API_URL)/agents/$$HOUSE_ID/loop/start \
	    -H "Content-Type: application/json" -d '{"interval":5}' > /dev/null && \
	  echo "  Loop started for house agent $$HOUSE_ID"
	@PLAYER_ID=$$(grep PLAYER_ID agent/.agent-ids | cut -d= -f2); \
	  curl -s -X POST $(API_URL)/agents/$$PLAYER_ID/loop/start \
	    -H "Content-Type: application/json" -d '{"interval":5}' > /dev/null && \
	  echo "  Loop started for player agent $$PLAYER_ID"
	@echo "All loops started and activated."

# ── Stop everything ───────────────────────────────────────────────────────────
stop:
	@lsof -ti:$(ANVIL_PORT) | xargs kill 2>/dev/null && echo "Stopped anvil" || true
	@lsof -ti:$(API_PORT)   | xargs kill 2>/dev/null && echo "Stopped API"   || true
	@lsof -ti:$(UI_PORT)    | xargs kill 2>/dev/null && echo "Stopped UI"    || true
	@lsof -ti:$(DAPP_PORT)         | xargs kill 2>/dev/null && echo "Stopped dApp"        || true
	@lsof -ti:$(PLAYLIST_UI_PORT) | xargs kill 2>/dev/null && echo "Stopped playlist UI" || true
	@pkill -f "tsx loop.ts"  2>/dev/null && echo "Stopped loops" || true
	@rm -f /tmp/loop-*.pid

# ── Clean (stop + wipe state) ─────────────────────────────────────────────────
clean: stop
	@rm -f $(BIN)
	@rm -f contracts.db api/contracts.db
	@rm -f agent/deployments.json agent/playlist-deployments.json agent/.agent-ids agent/.playlist-agent-ids
	@echo "Cleaned"
