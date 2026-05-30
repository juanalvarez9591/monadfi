# Monad Agent Scaffolding

A contract-agnostic harness for driving on-chain agents with a local LLM. Agents
read contract state, an LLM picks an action, and the runner executes it — applied
here to a **House Roulette + MonadToken** use case, but designed to work with any
contract.

## Architecture

```
 anvil (chain)  ◄──  agent runner (TS)  ──►  Go API  ──►  Ollama (qwen3)
                         │                      │
                  reads state, fills        picks ONE action
                  args, simulates &         from an enum (grammar-
                  sends txs                  constrained JSON)
```

Three ideas make agent execution **deterministic** and **crash-free**:

1. **Action selection via grammar-constrained output.** The API asks the model for
   `{"action": "<one-of-enum>"}` using Ollama's `format` JSON-schema. The model can
   only emit a valid action name. With `temperature 0` + a fixed `seed`, identical
   state yields identical decisions. Small models are reliable at this; few-shot
   examples in the agent prompt eliminate the remaining ambiguity.

2. **Deterministic argument resolution.** The LLM only *chooses* an action; the
   runner fills its arguments from each action's `argsTemplate` (`self`,
   `view:<fn>`, `const:<value>`, `random32`) — never from the model, which fills
   arguments poorly.

3. **Simulate-before-send.** Every tx is `eth_call`-simulated first. A call that
   would revert (wrong action for the state, a race, a guard) is skipped, not sent.
   A wrong pick becomes a retried no-op — so an agent can interact with **any**
   contract without erroring.

## Quick start

Prerequisites: `foundry`, `go`, `node`, and `ollama` running on `:11434` with a
tool-capable model pulled (`ollama pull qwen3:1.7b`).

```shell
# Unit tests: contracts (forge) + API (go)
make test

# Deterministic end-to-end round, driven entirely through the agents.
# Self-contained: spins up its own anvil + API, plays one full round, asserts
# the player wins and is paid. Repeatable and non-flaky.
make functional

# Full live stack (anvil + API + admin UI + player dApp + agent loops)
make all
```

### The functional test

`make functional` (→ `scripts/functional.sh` → `agent/functional.ts`) plays one
round: **house opens → player contributes → time advances past the window → house
resolves → player wins**. A single player makes the winner deterministic, so the
end state is fully predictable. Each decision is a real LLM call (~0.5–1s warm).

## Generic: any contract

The same schema works for arbitrary contracts — no code changes:

```shell
# Deploy any Foundry-compiled contract and auto-derive its agent schema from the ABI:
#   statuses = no-arg / single-address views
#   actions  = state-changing fns, each with an inferred argsTemplate
make deploy-any CONTRACT=MonadToken ARGS='["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"]'

# (or register an already-deployed one)
make autoregister CONTRACT=MonadToken
```

From there, tick the generated agent (`cd agent && npm run run -- <agentId> <wallet>`)
or refine its prompt/templates from the admin UI. Inferred templates need not be
perfect — simulate-before-send keeps wrong guesses from erroring.

## Model / determinism knobs

| Env            | Default      | Notes                                                        |
| -------------- | ------------ | ------------------------------------------------------------ |
| `OLLAMA_MODEL` | `qwen3:1.7b` | Reliable action selection. `qwen3:0.6b` is faster (~0.5s), less accurate — the simulate guard absorbs the difference. |
| `OLLAMA_SEED`  | `42`         | Fixed sampling seed for reproducible decisions.              |
| `OLLAMA_URL`   | `:11434`     | Ollama endpoint.                                             |

## Layout

| Path             | What                                                               |
| ---------------- | ----------------------------------------------------------------- |
| `src/`           | Contracts: `MonadToken`, `CasinoRoulette` (+ no-arg `can*` views)  |
| `test/`          | Foundry unit tests                                                 |
| `api/`           | Go API: registry (contracts/statuses/actions/agents) + `/run` decision endpoint + tests |
| `agent/`         | TS runner: `deploy`, `setup`, `fund`, `loop`, `functional`, generic `deploy:any`/`autoregister` |
| `agent/src/`     | Shared: chain client, wallets, ABI introspection, arg-resolution + simulate-before-send (`execute.ts`) |
| `scripts/`       | `functional.sh` — self-contained e2e harness                      |
| `ui/`, `dapp/`   | Admin UI and player dApp                                           |
```
