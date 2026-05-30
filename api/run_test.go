package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// actionSchema must produce a valid JSON schema whose action enum is exactly the
// provided names — this is what grammar-constrains the model to a known action.
func TestActionSchema(t *testing.T) {
	raw := actionSchema([]string{"openGame", "resolveGame", "wait"})

	var schema struct {
		Type       string `json:"type"`
		Properties struct {
			Action struct {
				Type string   `json:"type"`
				Enum []string `json:"enum"`
			} `json:"action"`
		} `json:"properties"`
		Required []string `json:"required"`
	}
	if err := json.Unmarshal(raw, &schema); err != nil {
		t.Fatalf("schema is not valid JSON: %v", err)
	}
	if schema.Type != "object" {
		t.Errorf("type = %q, want object", schema.Type)
	}
	if got := schema.Properties.Action.Enum; strings.Join(got, ",") != "openGame,resolveGame,wait" {
		t.Errorf("enum = %v, want [openGame resolveGame wait]", got)
	}
	if len(schema.Required) != 1 || schema.Required[0] != "action" {
		t.Errorf("required = %v, want [action]", schema.Required)
	}
}

func TestParseAction(t *testing.T) {
	enum := []string{"openGame", "resolveGame", "wait"}
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"clean json", `{"action":"openGame"}`, "openGame"},
		{"whitespace + pretty", "{\n  \"action\": \"resolveGame\"\n}", "resolveGame"},
		{"wait", `{"action":"wait"}`, "wait"},
		{"stray text wrapper falls back to scan", `sure! {"action": "openGame"} ok`, "openGame"},
		{"unparseable, no enum match", `I cannot decide`, ""},
		{"empty", ``, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := parseAction(c.in, enum); got != c.want {
				t.Errorf("parseAction(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// decisionOptions must be deterministic: temperature 0 and a fixed seed, with the
// seed overridable via OLLAMA_SEED.
func TestDecisionOptions(t *testing.T) {
	t.Setenv("OLLAMA_SEED", "")
	opts := decisionOptions()
	if opts["temperature"] != 0 {
		t.Errorf("temperature = %v, want 0", opts["temperature"])
	}
	if opts["seed"] != 42 {
		t.Errorf("default seed = %v, want 42", opts["seed"])
	}

	os.Setenv("OLLAMA_SEED", "1234")
	defer os.Unsetenv("OLLAMA_SEED")
	if got := decisionOptions()["seed"]; got != 1234 {
		t.Errorf("seed from env = %v, want 1234", got)
	}
}

func TestTruncate(t *testing.T) {
	if got := truncate("hello", 10); got != "hello" {
		t.Errorf("truncate short = %q", got)
	}
	if got := truncate("hello world", 5); got != "hello…" {
		t.Errorf("truncate long = %q", got)
	}
}
