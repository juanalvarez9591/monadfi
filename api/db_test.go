package main

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func testDB(t *testing.T) *DB {
	t.Helper()
	db, err := initDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("initDB: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

const sampleABI = `[{"type":"function","name":"openGame","inputs":[{"name":"randomSeed","type":"bytes32"}],"outputs":[]}]`
const openGameFragment = `{"type":"function","name":"openGame","inputs":[{"name":"randomSeed","type":"bytes32"}],"outputs":[]}`
const canOpenFragment = `{"type":"function","name":"canOpen","inputs":[],"outputs":[{"type":"bool"}],"stateMutability":"view"}`

func TestUpsertContract(t *testing.T) {
	db := testDB(t)

	c, err := db.upsertContract("CasinoRoulette", "0xabc", sampleABI, 31337, "2026-01-01")
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if c.ID == 0 || c.Name != "CasinoRoulette" {
		t.Fatalf("unexpected contract: %+v", c)
	}

	// Re-upsert with same (address, chainId) must not create a duplicate.
	c2, err := db.upsertContract("Renamed", "0xabc", sampleABI, 31337, "2026-01-01")
	if err != nil {
		t.Fatalf("re-upsert: %v", err)
	}
	if c2.ID != c.ID {
		t.Errorf("upsert created a duplicate: %d != %d", c2.ID, c.ID)
	}

	got, err := db.contractByAddress("0xabc", 31337)
	if err != nil {
		t.Fatalf("byAddress: %v", err)
	}
	if got.ID != c.ID {
		t.Errorf("byAddress id = %d, want %d", got.ID, c.ID)
	}
}

// The args_template column is what lets the runner fill arguments deterministically.
// It must round-trip and default to an empty object.
func TestCreateActionArgsTemplate(t *testing.T) {
	db := testDB(t)
	c, _ := db.upsertContract("Casino", "0xabc", sampleABI, 31337, "")

	tmpl := `{"randomSeed":"random32"}`
	a, err := db.createAction(c.ID, "openGame", openGameFragment, tmpl)
	if err != nil {
		t.Fatalf("createAction: %v", err)
	}
	if string(a.ArgsTemplate) != tmpl {
		t.Errorf("argsTemplate = %s, want %s", a.ArgsTemplate, tmpl)
	}
	if a.Contract.Name != "Casino" {
		t.Errorf("action not hydrated with contract: %+v", a.Contract)
	}

	// Round-trip via actionByID.
	got, err := db.actionByID(a.ID)
	if err != nil {
		t.Fatalf("actionByID: %v", err)
	}
	if string(got.ArgsTemplate) != tmpl {
		t.Errorf("persisted argsTemplate = %s, want %s", got.ArgsTemplate, tmpl)
	}

	// Empty template defaults to "{}".
	b, _ := db.createAction(c.ID, "resolveGame", openGameFragment, "")
	if string(b.ArgsTemplate) != "{}" {
		t.Errorf("empty template default = %s, want {}", b.ArgsTemplate)
	}
}

// An agent must hydrate with its linked statuses and actions, preserving the
// args templates the runner depends on.
func TestCreateAgentHydration(t *testing.T) {
	db := testDB(t)
	c, _ := db.upsertContract("Casino", "0xabc", sampleABI, 31337, "")

	st, err := db.createStatus(c.ID, "canOpen", canOpenFragment, nil)
	if err != nil {
		t.Fatalf("createStatus: %v", err)
	}
	act, _ := db.createAction(c.ID, "openGame", openGameFragment, `{"randomSeed":"random32"}`)

	agent, err := db.createAgent("be the house", []int64{st.ID}, []int64{act.ID})
	if err != nil {
		t.Fatalf("createAgent: %v", err)
	}

	got, err := db.agentByID(agent.ID)
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	if len(got.Statuses) != 1 || got.Statuses[0].FunctionName != "canOpen" {
		t.Errorf("statuses = %+v, want [canOpen]", got.Statuses)
	}
	if len(got.Actions) != 1 || got.Actions[0].FunctionName != "openGame" {
		t.Errorf("actions = %+v, want [openGame]", got.Actions)
	}
	if string(got.Actions[0].ArgsTemplate) != `{"randomSeed":"random32"}` {
		t.Errorf("hydrated action lost args template: %s", got.Actions[0].ArgsTemplate)
	}
	// args template must be valid JSON for the runner.
	if !json.Valid(got.Actions[0].ArgsTemplate) {
		t.Error("args template is not valid JSON")
	}
}

// A status address of nil means global state; a set address means user-scoped.
func TestGlobalVsScopedStatus(t *testing.T) {
	db := testDB(t)
	c, _ := db.upsertContract("Casino", "0xabc", sampleABI, 31337, "")

	global, err := db.createStatus(c.ID, "canOpen", canOpenFragment, nil)
	if err != nil {
		t.Fatalf("createStatus global: %v", err)
	}
	if global.Address != nil {
		t.Errorf("global status address = %v, want nil", *global.Address)
	}

	addr := "0xdead"
	scoped, err := db.createStatus(c.ID, "balanceOf", canOpenFragment, &addr)
	if err != nil {
		t.Fatalf("createStatus scoped: %v", err)
	}
	if scoped.Address == nil || *scoped.Address != addr {
		t.Errorf("scoped status address = %v, want %s", scoped.Address, addr)
	}
}
