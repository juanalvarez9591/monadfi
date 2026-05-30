package main

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type Status struct {
	ID           int64           `json:"id"`
	Contract     ContractSummary `json:"contract"`
	FunctionName string          `json:"functionName"`
	FunctionABI  json.RawMessage `json:"functionAbi"`
	Address      *string         `json:"address"` // nil = global; set = user-scoped
	CreatedAt    string          `json:"createdAt"`
}

// ── DB methods ────────────────────────────────────────────────────────────────

func (db *DB) createStatus(contractID int64, functionName, functionABI string, address *string) (Status, error) {
	res, err := db.Exec(`
		INSERT INTO statuses (contract_id, function_name, function_abi, address)
		VALUES (?, ?, ?, ?)
	`, contractID, functionName, functionABI, address)
	if err != nil {
		return Status{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Status{}, err
	}
	return db.statusByID(id)
}

func (db *DB) statusByID(id int64) (Status, error) {
	var s Status
	var rawABI string
	var addr sql.NullString
	err := db.QueryRow(`
		SELECT s.id, s.function_name, s.function_abi, s.address, s.created_at,
		       c.id, c.name, c.address, c.chain_id
		FROM statuses s
		JOIN contracts c ON c.id = s.contract_id
		WHERE s.id = ?
	`, id).Scan(
		&s.ID, &s.FunctionName, &rawABI, &addr, &s.CreatedAt,
		&s.Contract.ID, &s.Contract.Name, &s.Contract.Address, &s.Contract.ChainID,
	)
	if err != nil {
		return Status{}, err
	}
	s.FunctionABI = json.RawMessage(rawABI)
	if addr.Valid {
		s.Address = &addr.String
	}
	return s, nil
}

func (db *DB) listStatuses() ([]Status, error) {
	rows, err := db.Query(`
		SELECT s.id, s.function_name, s.function_abi, s.address, s.created_at,
		       c.id, c.name, c.address, c.chain_id
		FROM statuses s
		JOIN contracts c ON c.id = s.contract_id
		ORDER BY s.created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStatuses(rows)
}

func (db *DB) statusesByAgentID(agentID int64) ([]Status, error) {
	rows, err := db.Query(`
		SELECT s.id, s.function_name, s.function_abi, s.address, s.created_at,
		       c.id, c.name, c.address, c.chain_id
		FROM statuses s
		JOIN contracts c ON c.id = s.contract_id
		JOIN agent_statuses ags ON ags.status_id = s.id
		WHERE ags.agent_id = ?
		ORDER BY s.id
	`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStatuses(rows)
}

func scanStatuses(rows *sql.Rows) ([]Status, error) {
	var out []Status
	for rows.Next() {
		var s Status
		var rawABI string
		var addr sql.NullString
		if err := rows.Scan(
			&s.ID, &s.FunctionName, &rawABI, &addr, &s.CreatedAt,
			&s.Contract.ID, &s.Contract.Name, &s.Contract.Address, &s.Contract.ChainID,
		); err != nil {
			return nil, err
		}
		s.FunctionABI = json.RawMessage(rawABI)
		if addr.Valid {
			s.Address = &addr.String
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ── Handlers ──────────────────────────────────────────────────────────────────

type createStatusRequest struct {
	ContractID   int64           `json:"contractId"`
	FunctionName string          `json:"functionName"`
	FunctionABI  json.RawMessage `json:"functionAbi"` // accepts object or string
	Address      *string         `json:"address"`     // omit or null = global
}

// POST /statuses
func (h *handler) createStatusHandler(w http.ResponseWriter, r *http.Request) {
	var req createStatusRequest
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
	s, err := h.db.createStatus(req.ContractID, req.FunctionName, string(req.FunctionABI), req.Address)
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	addrStr := "global"
	if s.Address != nil {
		addrStr = *s.Address
	}
	slog.Info("status created", "id", s.ID, "function", s.FunctionName, "contract", s.Contract.Name, "address", addrStr)
	respond(w, http.StatusOK, s)
}

// GET /statuses
func (h *handler) listStatusesHandler(w http.ResponseWriter, r *http.Request) {
	statuses, err := h.db.listStatuses()
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	if statuses == nil {
		statuses = []Status{}
	}
	respond(w, http.StatusOK, statuses)
}

// GET /statuses/{id}
func (h *handler) getStatusHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		errResponse(w, http.StatusBadRequest, "invalid id")
		return
	}
	s, err := h.db.statusByID(id)
	if err != nil {
		errResponse(w, http.StatusNotFound, "status not found")
		return
	}
	respond(w, http.StatusOK, s)
}
