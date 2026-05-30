BIN          := bin/monad-api
API_URL      := http://localhost:8080
API_PORT     := 8080
ANVIL_PORT   := 8545
UI_PORT      := 5173
DAPP_PORT    := 5174
N_PLAYERS    ?= 2                # number of parallel player agents to spawn
OLLAMA_MODEL ?= qwen3:1.7b       # tool/enum-reliable model; qwen3:0.6b is faster, less accurate

# Generic deploy knobs — `make deploy-any CONTRACT=Foo ARGS='["0x.."]'`
CONTRACT ?=
ARGS     ?= []

export OLLAMA_MODEL

.PHONY: all anvil api ui dapp deploy fund loops stop clean test test-sol test-go \
        functional deploy-any autoregister

# ── Full bootstrap (clean slate → everything running) ─────────────────────────
all: clean anvil api deploy fund ui dapp loops
	@echo ""
	@echo "Everything is running."
	@echo "  Admin UI  → http://localhost:$(UI_PORT)"
	@echo "  Player UI → http://localhost:$(DAPP_PORT)  ← connect MetaMask here"
	@echo "  API       → http://localhost:$(API_PORT)"
	@echo "  Anvil     → http://localhost:$(ANVIL_PORT)"
	@echo ""
	@echo "Loop logs:"
	@echo "  tail -f /tmp/loop-house.log    (house agent $$(grep HOUSE_ID agent/.agent-ids | cut -d= -f2))"
	@for i in $$(seq 0 $$(($(N_PLAYERS)-1))); do echo "  tail -f /tmp/loop-player-$$i.log  (player agent $$(grep PLAYER_ID agent/.agent-ids | cut -d= -f2), wallet $$i)"; done

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
	@lsof -ti:$(DAPP_PORT)  | xargs kill 2>/dev/null && echo "Stopped dApp"  || true
	@pkill -f "tsx loop.ts"  2>/dev/null && echo "Stopped loops" || true
	@rm -f /tmp/loop-*.pid

# ── Clean (stop + wipe state) ─────────────────────────────────────────────────
clean: stop
	@rm -f $(BIN)
	@rm -f contracts.db api/contracts.db
	@rm -f agent/deployments.json agent/.agent-ids
	@echo "Cleaned"
