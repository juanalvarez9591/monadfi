package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type LoopState struct {
	AgentID    int64   `json:"agentId"`
	Running    bool    `json:"running"`
	Interval   int     `json:"interval"` // seconds
	Iterations int64   `json:"iterations"`
	StartedAt  *string `json:"startedAt,omitempty"`
	LastRunAt  *string `json:"lastRunAt,omitempty"`
	LastAction *string `json:"lastAction,omitempty"`
}

type LoopRegistry struct {
	mu    sync.RWMutex
	loops map[int64]*LoopState
}

func NewLoopRegistry() *LoopRegistry {
	return &LoopRegistry{loops: make(map[int64]*LoopState)}
}

func (lr *LoopRegistry) get(agentID int64) *LoopState {
	lr.mu.RLock()
	defer lr.mu.RUnlock()
	if s, ok := lr.loops[agentID]; ok {
		cp := *s
		return &cp
	}
	return nil
}

func (lr *LoopRegistry) start(agentID int64, interval int) *LoopState {
	lr.mu.Lock()
	defer lr.mu.Unlock()
	now := time.Now().UTC().Format(time.RFC3339)
	s := &LoopState{
		AgentID:   agentID,
		Running:   true,
		Interval:  interval,
		StartedAt: &now,
	}
	lr.loops[agentID] = s
	return s
}

func (lr *LoopRegistry) stop(agentID int64) *LoopState {
	lr.mu.Lock()
	defer lr.mu.Unlock()
	s, ok := lr.loops[agentID]
	if !ok {
		return nil
	}
	s.Running = false
	cp := *s
	return &cp
}

func (lr *LoopRegistry) tick(agentID int64, lastAction string) *LoopState {
	lr.mu.Lock()
	defer lr.mu.Unlock()
	s, ok := lr.loops[agentID]
	if !ok {
		return nil
	}
	s.Iterations++
	now := time.Now().UTC().Format(time.RFC3339)
	s.LastRunAt = &now
	s.LastAction = &lastAction
	cp := *s
	return &cp
}

func (lr *LoopRegistry) listAll() []LoopState {
	lr.mu.RLock()
	defer lr.mu.RUnlock()
	out := make([]LoopState, 0, len(lr.loops))
	for _, s := range lr.loops {
		out = append(out, *s)
	}
	return out
}

// ── Handlers ──────────────────────────────────────────────────────────────────

type startLoopRequest struct {
	Interval int `json:"interval"` // seconds; default 10
}

type tickRequest struct {
	LastAction string `json:"lastAction"`
}

// POST /agents/{id}/loop/start
func (h *handler) startLoopHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		errResponse(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req startLoopRequest
	json.NewDecoder(r.Body).Decode(&req) //nolint:errcheck
	if req.Interval <= 0 {
		req.Interval = 10
	}

	// Verify agent exists
	if _, err := h.db.agentByID(id); err != nil {
		errResponse(w, http.StatusNotFound, "agent not found")
		return
	}

	state := h.loops.start(id, req.Interval)
	slog.Info("loop started",
		"agentId", id,
		"interval", req.Interval,
	)
	respond(w, http.StatusOK, state)
}

// POST /agents/{id}/loop/stop
func (h *handler) stopLoopHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		errResponse(w, http.StatusBadRequest, "invalid id")
		return
	}
	state := h.loops.stop(id)
	if state == nil {
		errResponse(w, http.StatusNotFound, "no loop found for agent")
		return
	}
	slog.Info("loop stopped",
		"agentId", id,
		"iterations", state.Iterations,
	)
	respond(w, http.StatusOK, state)
}

// GET /agents/{id}/loop/status
func (h *handler) loopStatusHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		errResponse(w, http.StatusBadRequest, "invalid id")
		return
	}
	state := h.loops.get(id)
	if state == nil {
		respond(w, http.StatusOK, LoopState{AgentID: id, Running: false, Interval: 10})
		return
	}
	respond(w, http.StatusOK, state)
}

// POST /agents/{id}/loop/tick  — called by the TypeScript runner each iteration
func (h *handler) loopTickHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		errResponse(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req tickRequest
	json.NewDecoder(r.Body).Decode(&req) //nolint:errcheck

	state := h.loops.tick(id, req.LastAction)
	if state == nil {
		errResponse(w, http.StatusNotFound, "no loop found for agent")
		return
	}
	slog.Info("loop tick",
		"agentId", id,
		"iteration", state.Iterations,
		"lastAction", req.LastAction,
	)
	respond(w, http.StatusOK, state)
}

// GET /loops  — all loop states
func (h *handler) listLoopsHandler(w http.ResponseWriter, r *http.Request) {
	states := h.loops.listAll()
	if states == nil {
		states = []LoopState{}
	}
	respond(w, http.StatusOK, states)
}
