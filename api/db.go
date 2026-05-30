package main

import (
	"database/sql"

	_ "modernc.org/sqlite"
)

type DB struct{ *sql.DB }

func initDB(path string) (*DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS contracts (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			name        TEXT    NOT NULL,
			address     TEXT    NOT NULL,
			abi         TEXT    NOT NULL,
			chain_id    INTEGER NOT NULL DEFAULT 0,
			deployed_at TEXT    NOT NULL DEFAULT '',
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(address, chain_id)
		);

		-- An action is a write call: one contract function, performed by one address.
		-- args_template maps each function parameter name to a deterministic source
		-- token resolved by the runner (e.g. "self", "view:gameCount", "const:100",
		-- "random32"). It lets the agent pick *which* action to call while the runner
		-- fills the arguments — small models are reliable at the former, not the latter.
		CREATE TABLE IF NOT EXISTS actions (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			contract_id   INTEGER NOT NULL REFERENCES contracts(id),
			function_name TEXT    NOT NULL,
			function_abi  TEXT    NOT NULL, -- single ABI fragment (JSON)
			address       TEXT    NOT NULL, -- wallet that performs this action
			args_template TEXT    NOT NULL DEFAULT '{}', -- param name → source token (JSON)
			created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		-- A status is a read call: one contract function, optionally scoped to an address.
		-- address IS NULL  → global state (anyone can query, same result)
		-- address NOT NULL → user-scoped state (result differs per address)
		CREATE TABLE IF NOT EXISTS statuses (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			contract_id   INTEGER NOT NULL REFERENCES contracts(id),
			function_name TEXT    NOT NULL,
			function_abi  TEXT    NOT NULL, -- single ABI fragment (JSON)
			address       TEXT,             -- NULL = global
			created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		-- An agent has a prompt and a scoped set of statuses + actions.
		CREATE TABLE IF NOT EXISTS agents (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			prompt     TEXT    NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS agent_statuses (
			agent_id  INTEGER NOT NULL REFERENCES agents(id),
			status_id INTEGER NOT NULL REFERENCES statuses(id),
			PRIMARY KEY (agent_id, status_id)
		);

		CREATE TABLE IF NOT EXISTS agent_actions (
			agent_id  INTEGER NOT NULL REFERENCES agents(id),
			action_id INTEGER NOT NULL REFERENCES actions(id),
			PRIMARY KEY (agent_id, action_id)
		);
	`)

	return &DB{db}, err
}
