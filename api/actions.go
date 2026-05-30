package main

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type Action struct {
	ID           int64           `json:"id"`
	Contract     ContractSummary `json:"contract"`
	FunctionName string          `json:"functionName"`
	FunctionABI  json.RawMessage `json:"functionAbi"`
	ArgsTemplate json.RawMessage `json:"argsTemplate"`
	CreatedAt    string          `json:"createdAt"`
}

// ── DB methods ────────────────────────────────────────────────────────────────

func (db *DB) createAction(contractID int64, functionName, functionABI, argsTemplate string) (Action, error) {
	if argsTemplate == "" {
		argsTemplate = "{}"
	}
	res, err := db.Exec(`
		INSERT INTO actions (contract_id, function_name, function_abi, address, args_template)
		VALUES (?, ?, ?, '', ?)
	`, contractID, functionName, functionABI, argsTemplate)
	if err != nil {
		return Action{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Action{}, err
	}
	return db.actionByID(id)
}

func (db *DB) deleteAction(id int64) error {
	_, err := db.Exec(`DELETE FROM actions WHERE id = ?`, id)
	return err
}

func (db *DB) actionByID(id int64) (Action, error) {
	var a Action
	var rawABI, rawTmpl string
	err := db.QueryRow(`
		SELECT a.id, a.function_name, a.function_abi, a.args_template, a.created_at,
		       c.id, c.name, c.address, c.chain_id
		FROM actions a
		JOIN contracts c ON c.id = a.contract_id
		WHERE a.id = ?
	`, id).Scan(
		&a.ID, &a.FunctionName, &rawABI, &rawTmpl, &a.CreatedAt,
		&a.Contract.ID, &a.Contract.Name, &a.Contract.Address, &a.Contract.ChainID,
	)
	if err != nil {
		return Action{}, err
	}
	a.FunctionABI = json.RawMessage(rawABI)
	a.ArgsTemplate = json.RawMessage(rawTmpl)
	return a, nil
}

func (db *DB) listActions() ([]Action, error) {
	rows, err := db.Query(`
		SELECT a.id, a.function_name, a.function_abi, a.args_template, a.created_at,
		       c.id, c.name, c.address, c.chain_id
		FROM actions a
		JOIN contracts c ON c.id = a.contract_id
		ORDER BY a.created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanActions(rows)
}

func (db *DB) actionsByAgentID(agentID int64) ([]Action, error) {
	rows, err := db.Query(`
		SELECT a.id, a.function_name, a.function_abi, a.args_template, a.created_at,
		       c.id, c.name, c.address, c.chain_id
		FROM actions a
		JOIN contracts c ON c.id = a.contract_id
		JOIN agent_actions aa ON aa.action_id = a.id
		WHERE aa.agent_id = ?
		ORDER BY a.id
	`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanActions(rows)
}

func scanActions(rows *sql.Rows) ([]Action, error) {
	var out []Action
	for rows.Next() {
		var a Action
		var rawABI, rawTmpl string
		if err := rows.Scan(
			&a.ID, &a.FunctionName, &rawABI, &rawTmpl, &a.CreatedAt,
			&a.Contract.ID, &a.Contract.Name, &a.Contract.Address, &a.Contract.ChainID,
		); err != nil {
			return nil, err
		}
		a.FunctionABI = json.RawMessage(rawABI)
		a.ArgsTemplate = json.RawMessage(rawTmpl)
		out = append(out, a)
	}
	return out, rows.Err()
}

// ── Handlers ──────────────────────────────────────────────────────────────────

type createActionRequest struct {
	ContractID   int64           `json:"contractId"`
	FunctionName string          `json:"functionName"`
	FunctionABI  json.RawMessage `json:"functionAbi"`
	ArgsTemplate json.RawMessage `json:"argsTemplate"`
}

// POST /actions
func (h *handler) createActionHandler(w http.ResponseWriter, r *http.Request) {
	var req createActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResponse(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.ContractID == 0 {
		errResponse(w, http.StatusBadRequest, "contractId is required")
		return
	}
	if req.FunctionName == "" {
		errResponse(w, http.StatusBadRequest, "functionName is required")
		return
	}
	if len(req.FunctionABI) == 0 || !json.Valid(req.FunctionABI) {
		errResponse(w, http.StatusBadRequest, "functionAbi must be valid JSON")
		return
	}
	tmpl := "{}"
	if len(req.ArgsTemplate) > 0 {
		if !json.Valid(req.ArgsTemplate) {
			errResponse(w, http.StatusBadRequest, "argsTemplate must be valid JSON")
			return
		}
		tmpl = string(req.ArgsTemplate)
	}
	a, err := h.db.createAction(req.ContractID, req.FunctionName, string(req.FunctionABI), tmpl)
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Info("action created", "id", a.ID, "function", a.FunctionName, "contract", a.Contract.Name)
	respond(w, http.StatusOK, a)
}

// GET /actions
func (h *handler) listActionsHandler(w http.ResponseWriter, r *http.Request) {
	actions, err := h.db.listActions()
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	if actions == nil {
		actions = []Action{}
	}
	respond(w, http.StatusOK, actions)
}

// GET /actions/{id}
func (h *handler) getActionHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		errResponse(w, http.StatusBadRequest, "invalid id")
		return
	}
	a, err := h.db.actionByID(id)
	if err != nil {
		errResponse(w, http.StatusNotFound, "action not found")
		return
	}
	respond(w, http.StatusOK, a)
}

// DELETE /actions/{id}
func (h *handler) deleteActionHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		errResponse(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.db.deleteAction(id); err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Info("action deleted", "id", id)
	respond(w, http.StatusOK, map[string]any{"deleted": id})
}
