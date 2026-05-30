package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
)

// ── Request / Response ────────────────────────────────────────────────────────

// StateEntry is one status reading sent by the TypeScript runner.
type StateEntry struct {
	FunctionName string `json:"functionName"`
	Address      any    `json:"address"` // string | null
	Result       any    `json:"result"`
}

type RunRequest struct {
	State []StateEntry `json:"state"`
}

type RunResponse struct {
	ActionID     int64           `json:"actionId"`
	FunctionName string          `json:"functionName"`
	ArgsTemplate json.RawMessage `json:"argsTemplate"` // param name → source token; runner resolves
	Reasoning    string          `json:"reasoning"`
}

// decision is the grammar-constrained JSON the model returns: just an action name.
// Small models reliably pick from an enum but fill arguments poorly, so the runner
// resolves arguments deterministically from the action's ArgsTemplate instead.
type decision struct {
	Action string `json:"action"`
}

const waitAction = "wait"

// ── Handler ───────────────────────────────────────────────────────────────────

// POST /agents/{id}/run
func (h *handler) runAgentHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		errResponse(w, http.StatusBadRequest, "invalid id")
		return
	}

	var req RunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResponse(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	agent, err := h.db.agentByID(id)
	if err != nil {
		errResponse(w, http.StatusNotFound, "agent not found")
		return
	}

	// ── Build the action enum (function names + "wait") ──────────────────────
	enum := make([]string, 0, len(agent.Actions)+1)
	for _, action := range agent.Actions {
		enum = append(enum, action.FunctionName)
	}
	enum = append(enum, waitAction)
	schema := actionSchema(enum)

	// ── Build compact state line ─────────────────────────────────────────────
	var sb strings.Builder
	for _, s := range req.State {
		v, _ := json.Marshal(s.Result)
		sb.WriteString(fmt.Sprintf("%s=%s ", s.FunctionName, v))
	}

	messages := []OllamaMessage{
		{Role: "system", Content: agent.Prompt},
		{Role: "user", Content: "State: " + strings.TrimSpace(sb.String()) +
			"\nReply with the single action to take now."},
	}

	// ── Call Ollama with grammar-constrained output (deterministic) ───────────
	ollamaResp, err := h.ollama.Chat(OllamaChatRequest{
		Messages: messages,
		Think:    false,
		Format:   schema,
		Options:  decisionOptions(),
	})
	if err != nil {
		errResponse(w, http.StatusInternalServerError, "ollama error: "+err.Error())
		return
	}

	reasoning := ollamaResp.Message.Content

	// ── Parse decision ────────────────────────────────────────────────────────
	chosen := parseAction(reasoning, enum)
	if chosen == "" || chosen == waitAction {
		slog.Info("agent no-op", "agentId", id, "raw", truncate(reasoning, 120))
		respond(w, http.StatusOK, map[string]any{
			"action":    nil,
			"reasoning": reasoning,
		})
		return
	}

	var matchedAction *Action
	for i := range agent.Actions {
		if agent.Actions[i].FunctionName == chosen {
			a := agent.Actions[i]
			matchedAction = &a
			break
		}
	}
	if matchedAction == nil {
		// Grammar guarantees one of the enum values, so this only happens if the
		// agent has no matching action — treat as a no-op rather than an error.
		slog.Warn("agent chose unmatched action", "agentId", id, "action", chosen)
		respond(w, http.StatusOK, map[string]any{"action": nil, "reasoning": reasoning})
		return
	}

	slog.Info("agent decision", "agentId", id, "action", chosen)
	respond(w, http.StatusOK, RunResponse{
		ActionID:     matchedAction.ID,
		FunctionName: chosen,
		ArgsTemplate: matchedAction.ArgsTemplate,
		Reasoning:    reasoning,
	})
}

// actionSchema builds a JSON schema that forces the model to emit exactly
// {"action": "<one of enum>"} — grammar-constrained, so output is always valid.
func actionSchema(enum []string) json.RawMessage {
	vals := make([]string, len(enum))
	copy(vals, enum)
	b, _ := json.Marshal(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"action": map[string]any{"type": "string", "enum": vals},
		},
		"required":             []string{"action"},
		"additionalProperties": false,
	})
	return b
}

// parseAction extracts the chosen action from the model's JSON output, falling
// back to a substring scan if the model wrapped it in stray text.
func parseAction(content string, enum []string) string {
	var d decision
	if err := json.Unmarshal([]byte(strings.TrimSpace(content)), &d); err == nil && d.Action != "" {
		return d.Action
	}
	for _, name := range enum {
		if strings.Contains(content, `"`+name+`"`) {
			return name
		}
	}
	return ""
}

// decisionOptions returns deterministic sampling options. temperature 0 + a fixed
// seed make identical inputs produce identical outputs; the small token budget
// keeps latency near the target.
func decisionOptions() map[string]any {
	seed := 42
	if s := os.Getenv("OLLAMA_SEED"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			seed = n
		}
	}
	return map[string]any{
		"temperature": 0,
		"seed":        seed,
		"num_predict": 32,
		"num_ctx":     1024,
		"top_p":       1,
		"top_k":       1,
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
