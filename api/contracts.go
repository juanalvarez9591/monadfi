package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type Contract struct {
	ID         int64           `json:"id"`
	Name       string          `json:"name"`
	Address    string          `json:"address"`
	ABI        json.RawMessage `json:"abi"`
	ChainID    int64           `json:"chainId"`
	DeployedAt string          `json:"deployedAt"`
	CreatedAt  string          `json:"createdAt"`
}

// ContractSummary is embedded in Action/Status/Agent responses — no full ABI.
type ContractSummary struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Address string `json:"address"`
	ChainID int64  `json:"chainId"`
}

// ── DB methods ────────────────────────────────────────────────────────────────

func (db *DB) upsertContract(name, address, abi string, chainID int64, deployedAt string) (Contract, error) {
	_, err := db.Exec(`
		INSERT INTO contracts (name, address, abi, chain_id, deployed_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(address, chain_id) DO UPDATE SET
			name        = excluded.name,
			abi         = excluded.abi,
			deployed_at = excluded.deployed_at
	`, name, address, abi, chainID, deployedAt)
	if err != nil {
		return Contract{}, err
	}
	return db.contractByAddress(address, chainID)
}

func (db *DB) contractByAddress(address string, chainID int64) (Contract, error) {
	var c Contract
	var rawABI string
	err := db.QueryRow(`
		SELECT id, name, address, abi, chain_id, deployed_at, created_at
		FROM contracts WHERE address = ? AND chain_id = ?
	`, address, chainID).Scan(&c.ID, &c.Name, &c.Address, &rawABI, &c.ChainID, &c.DeployedAt, &c.CreatedAt)
	if err != nil {
		return Contract{}, err
	}
	c.ABI = json.RawMessage(rawABI)
	return c, nil
}

func (db *DB) deleteContract(id int64) error {
	_, err := db.Exec(`DELETE FROM contracts WHERE id = ?`, id)
	return err
}

func (db *DB) renameContract(id int64, name string) (Contract, error) {
	_, err := db.Exec(`UPDATE contracts SET name = ? WHERE id = ?`, name, id)
	if err != nil {
		return Contract{}, err
	}
	var c Contract
	var rawABI string
	err = db.QueryRow(`SELECT id, name, address, abi, chain_id, deployed_at, created_at FROM contracts WHERE id = ?`, id).
		Scan(&c.ID, &c.Name, &c.Address, &rawABI, &c.ChainID, &c.DeployedAt, &c.CreatedAt)
	if err != nil {
		return Contract{}, err
	}
	c.ABI = json.RawMessage(rawABI)
	return c, nil
}

func (db *DB) contractSummaryByID(id int64) (ContractSummary, error) {
	var s ContractSummary
	err := db.QueryRow(`
		SELECT id, name, address, chain_id FROM contracts WHERE id = ?
	`, id).Scan(&s.ID, &s.Name, &s.Address, &s.ChainID)
	return s, err
}

func (db *DB) listContracts() ([]Contract, error) {
	rows, err := db.Query(`
		SELECT id, name, address, abi, chain_id, deployed_at, created_at
		FROM contracts ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Contract
	for rows.Next() {
		var c Contract
		var rawABI string
		if err := rows.Scan(&c.ID, &c.Name, &c.Address, &rawABI, &c.ChainID, &c.DeployedAt, &c.CreatedAt); err != nil {
			return nil, err
		}
		c.ABI = json.RawMessage(rawABI)
		out = append(out, c)
	}
	return out, rows.Err()
}

// ── Handlers ──────────────────────────────────────────────────────────────────

type putContractRequest struct {
	Name       string `json:"name"`
	Address    string `json:"address"`
	ABI        string `json:"abi"`
	ChainID    int64  `json:"chainId"`
	DeployedAt string `json:"deployedAt"`
}

// POST /contracts
func (h *handler) putContract(w http.ResponseWriter, r *http.Request) {
	var req putContractRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errResponse(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.Address == "" {
		errResponse(w, http.StatusBadRequest, "address is required")
		return
	}
	if !json.Valid([]byte(req.ABI)) {
		errResponse(w, http.StatusBadRequest, "abi must be valid JSON")
		return
	}
	c, err := h.db.upsertContract(req.Name, req.Address, req.ABI, req.ChainID, req.DeployedAt)
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Info("contract registered", "id", c.ID, "name", c.Name, "address", c.Address, "chainId", c.ChainID)
	respond(w, http.StatusOK, c)
}

// GET /contracts
func (h *handler) listContractsHandler(w http.ResponseWriter, r *http.Request) {
	contracts, err := h.db.listContracts()
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	if contracts == nil {
		contracts = []Contract{}
	}
	respond(w, http.StatusOK, contracts)
}

// DELETE /contracts/{id}
func (h *handler) deleteContractHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		errResponse(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.db.deleteContract(id); err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Info("contract deleted", "id", id)
	respond(w, http.StatusOK, map[string]any{"deleted": id})
}

// PATCH /contracts/{id}  — rename only
func (h *handler) renameContractHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		errResponse(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		errResponse(w, http.StatusBadRequest, "name is required")
		return
	}
	c, err := h.db.renameContract(id, body.Name)
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Info("contract renamed", "id", id, "name", body.Name)
	respond(w, http.StatusOK, c)
}

// GET /contracts/{address}
func (h *handler) getContractHandler(w http.ResponseWriter, r *http.Request) {
	address := r.PathValue("address")
	chainID := int64(31337)
	if q := r.URL.Query().Get("chainId"); q != "" {
		if id, err := strconv.ParseInt(q, 10, 64); err == nil {
			chainID = id
		}
	}
	c, err := h.db.contractByAddress(address, chainID)
	if err != nil {
		errResponse(w, http.StatusNotFound, "contract not found")
		return
	}
	respond(w, http.StatusOK, c)
}
