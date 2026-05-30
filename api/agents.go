package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type Agent struct {
	ID        int64    `json:"id"`
	Name      string   `json:"name"`
	RoleID    string   `json:"roleId"`
	Prompt    string   `json:"prompt"`
	CreatedAt string   `json:"createdAt"`
	Statuses  []Status `json:"statuses"`
	Actions   []Action `json:"actions"`
}

// ── DB methods ────────────────────────────────────────────────────────────────

func (db *DB) createAgent(name, roleID, prompt string, statusIDs, actionIDs []int64) (Agent, error) {
	tx, err := db.Begin()
	if err != nil {
		return Agent{}, err
	}
	defer tx.Rollback() //nolint:errcheck

	res, err := tx.Exec(`INSERT INTO agents (name, role_id, prompt) VALUES (?, ?, ?)`, name, roleID, prompt)
	if err != nil {
		return Agent{}, err
	}
	agentID, err := res.LastInsertId()
	if err != nil {
		return Agent{}, err
	}

	for _, sid := range statusIDs {
		if _, err := tx.Exec(`
			INSERT INTO agent_statuses (agent_id, status_id) VALUES (?, ?)
		`, agentID, sid); err != nil {
			return Agent{}, err
		}
	}
	for _, aid := range actionIDs {
		if _, err := tx.Exec(`
			INSERT INTO agent_actions (agent_id, action_id) VALUES (?, ?)
		`, agentID, aid); err != nil {
			return Agent{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return Agent{}, err
	}
	return db.agentByID(agentID)
}

func (db *DB) agentByID(id int64) (Agent, error) {
	var a Agent
	err := db.QueryRow(`
		SELECT id, name, role_id, prompt, created_at FROM agents WHERE id = ?
	`, id).Scan(&a.ID, &a.Name, &a.RoleID, &a.Prompt, &a.CreatedAt)
	if err != nil {
		return Agent{}, err
	}

	statuses, err := db.statusesByAgentID(id)
	if err != nil {
		return Agent{}, err
	}
	actions, err := db.actionsByAgentID(id)
	if err != nil {
		return Agent{}, err
	}

	if statuses == nil {
		statuses = []Status{}
	}
	if actions == nil {
		actions = []Action{}
	}
	a.Statuses = statuses
	a.Actions = actions
	return a, nil
}

func (db *DB) listAgents() ([]Agent, error) {
	rows, err := db.Query(`SELECT id, name, role_id, prompt, created_at FROM agents ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Agent
	for rows.Next() {
		var a Agent
		if err := rows.Scan(&a.ID, &a.Name, &a.RoleID, &a.Prompt, &a.CreatedAt); err != nil {
			return nil, err
		}
		statuses, _ := db.statusesByAgentID(a.ID)
		actions, _  := db.actionsByAgentID(a.ID)
		if statuses == nil { statuses = []Status{} }
		if actions == nil  { actions  = []Action{} }
		a.Statuses = statuses
		a.Actions  = actions
		out = append(out, a)
	}
	return out, rows.Err()
}

// ── Handlers ──────────────────────────────────────────────────────────────────

type createAgentRequest struct {
	Name      string  `json:"name"`
	RoleID    string  `json:"roleId"`
	Prompt    string  `json:"prompt"`
	StatusIDs []int64 `json:"statusIds"`
	ActionIDs []int64 `json:"actionIds"`
}

// POST /agents
func (h *handler) createAgentHandler(w http.ResponseWriter, r *http.Request) {
	var req createAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResponse(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.Prompt == "" {
		errResponse(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if len(req.ActionIDs) == 0 {
		errResponse(w, http.StatusBadRequest, "an agent must have at least one action")
		return
	}
	a, err := h.db.createAgent(req.Name, req.RoleID, req.Prompt, req.StatusIDs, req.ActionIDs)
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Info("agent created",
		"id", a.ID,
		"statuses", len(a.Statuses),
		"actions", len(a.Actions),
		"prompt", truncate(req.Prompt, 80),
	)
	respond(w, http.StatusCreated, a)
}

// GET /agents
func (h *handler) listAgentsHandler(w http.ResponseWriter, r *http.Request) {
	agents, err := h.db.listAgents()
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	if agents == nil {
		agents = []Agent{}
	}
	respond(w, http.StatusOK, agents)
}

// POST /agents/{id}/duplicate
func (h *handler) duplicateAgentHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		errResponse(w, http.StatusBadRequest, "invalid id")
		return
	}
	orig, err := h.db.agentByID(id)
	if err != nil {
		errResponse(w, http.StatusNotFound, "agent not found")
		return
	}
	statusIDs := make([]int64, len(orig.Statuses))
	for i, s := range orig.Statuses {
		statusIDs[i] = s.ID
	}
	actionIDs := make([]int64, len(orig.Actions))
	for i, a := range orig.Actions {
		actionIDs[i] = a.ID
	}
	copy, err := h.db.createAgent(orig.Name+" (copy)", orig.RoleID, orig.Prompt+" (copy)", statusIDs, actionIDs)
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Info("agent duplicated", "originalId", id, "newId", copy.ID)
	respond(w, http.StatusCreated, copy)
}

// GET /agents/{id}
func (h *handler) getAgentHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		errResponse(w, http.StatusBadRequest, "invalid id")
		return
	}
	a, err := h.db.agentByID(id)
	if err != nil {
		errResponse(w, http.StatusNotFound, "agent not found")
		return
	}
	respond(w, http.StatusOK, a)
}
