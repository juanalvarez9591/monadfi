package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"sync"
	"testing"
	"time"
)

const nAgents = 100

// mockOllamaServer returns an httptest.Server that immediately responds with the
// given action name, simulating Ollama without the model latency.
func mockOllamaServer(action string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(OllamaChatResponse{ //nolint:errcheck
			Model:   "qwen3:1.7b",
			Message: OllamaMessage{Role: "assistant", Content: fmt.Sprintf(`{"action":%q}`, action)},
			Done:    true,
		})
	}))
}

// seedAgents creates n agents in db, each sharing one action, and returns their IDs.
func seedAgents(t *testing.T, db *DB, n int) []int64 {
	t.Helper()
	c, err := db.upsertContract("LoadCasino", "0xload", sampleABI, 31337, "")
	if err != nil {
		t.Fatalf("upsertContract: %v", err)
	}
	act, err := db.createAction(c.ID, "openGame", openGameFragment, `{"randomSeed":"random32"}`)
	if err != nil {
		t.Fatalf("createAction: %v", err)
	}
	ids := make([]int64, n)
	for i := range n {
		agent, err := db.createAgent(fmt.Sprintf("load-agent-%d", i), nil, []int64{act.ID})
		if err != nil {
			t.Fatalf("createAgent %d: %v", i, err)
		}
		ids[i] = agent.ID
	}
	return ids
}

// runLoad fires n concurrent POST /agents/{id}/run requests against srvURL,
// one per agent in agentIDs, and returns the individual latencies and error count.
func runLoad(t *testing.T, srvURL string, agentIDs []int64) (latencies []time.Duration, errCount int) {
	t.Helper()
	state := RunRequest{State: []StateEntry{{FunctionName: "canOpen", Result: true}}}
	body, _ := json.Marshal(state)

	type result struct {
		d   time.Duration
		ok  bool
	}
	results := make([]result, len(agentIDs))
	var wg sync.WaitGroup
	wg.Add(len(agentIDs))

	for i, id := range agentIDs {
		go func(idx int, agentID int64) {
			defer wg.Done()
			url := fmt.Sprintf("%s/agents/%d/run", srvURL, agentID)
			t0 := time.Now()
			resp, err := http.Post(url, "application/json", bytes.NewReader(body))
			d := time.Since(t0)
			if err != nil || resp.StatusCode != http.StatusOK {
				results[idx] = result{d: d, ok: false}
				if err == nil {
					resp.Body.Close()
				}
				return
			}
			resp.Body.Close()
			results[idx] = result{d: d, ok: true}
		}(i, id)
	}
	wg.Wait()

	for _, r := range results {
		if r.ok {
			latencies = append(latencies, r.d)
		} else {
			errCount++
		}
	}
	return
}

func printStats(t *testing.T, label string, total time.Duration, latencies []time.Duration, errCount, n int) {
	t.Helper()
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	pct := func(p float64) time.Duration {
		if len(latencies) == 0 {
			return 0
		}
		return latencies[int(float64(len(latencies)-1)*p/100)]
	}
	t.Logf("──── %s ────", label)
	t.Logf("agents:       %d", n)
	t.Logf("success:      %d / %d", len(latencies), n)
	t.Logf("errors:       %d", errCount)
	t.Logf("wall time:    %s", total.Round(time.Millisecond))
	t.Logf("min latency:  %s", pct(0).Round(time.Microsecond))
	t.Logf("p50 latency:  %s", pct(50).Round(time.Microsecond))
	t.Logf("p95 latency:  %s", pct(95).Round(time.Microsecond))
	t.Logf("p99 latency:  %s", pct(99).Round(time.Microsecond))
	t.Logf("max latency:  %s", pct(100).Round(time.Microsecond))
}

// TestLoad100AgentsMocked spins up the real Go handler with a mock Ollama that
// responds instantly.  This isolates the API+DB concurrency from model latency.
// Run with: go test -v -run TestLoad100AgentsMocked ./api/
func TestLoad100AgentsMocked(t *testing.T) {
	mock := mockOllamaServer("openGame")
	defer mock.Close()

	db := testDB(t)
	h := &handler{
		db: db,
		ollama: &OllamaClient{
			BaseURL: mock.URL,
			Model:   "qwen3:1.7b",
			http:    &http.Client{Timeout: 10 * time.Second},
		},
		loops: NewLoopRegistry(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /agents/{id}/run", h.runAgentHandler)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	agentIDs := seedAgents(t, db, nAgents)

	start := time.Now()
	latencies, errCount := runLoad(t, srv.URL, agentIDs)
	wall := time.Since(start)

	printStats(t, "mocked Ollama — Go API concurrency", wall, latencies, errCount, nAgents)
	if errCount > 0 {
		t.Errorf("%d / %d requests failed", errCount, nAgents)
	}
}

// TestLoad100AgentsLive fires 100 concurrent requests at a real running API
// server (default http://localhost:8080) against a real Ollama instance.
// It is skipped automatically when the API server is not reachable.
//
// Start the stack first:
//   cd api && go run . &
//   npm run setup   # registers agents
//
// Then run:
//   go test -v -run TestLoad100AgentsLive -timeout 300s ./api/
//
// To override the API URL:
//   API_URL=http://localhost:8080 go test -v -run TestLoad100AgentsLive -timeout 300s ./api/
func TestLoad100AgentsLive(t *testing.T) {
	apiURL := "http://localhost:8080"

	// Probe the server; skip rather than fail if it's not running.
	probe, err := http.Get(apiURL + "/agents")
	if err != nil {
		t.Skipf("API not reachable at %s — start with `go run ./api`: %v", apiURL, err)
	}
	probe.Body.Close()
	if probe.StatusCode != http.StatusOK {
		t.Skipf("API /agents returned %d, skipping live test", probe.StatusCode)
	}

	// Fetch existing agents from the live server.
	resp, err := http.Get(apiURL + "/agents")
	if err != nil {
		t.Fatalf("GET /agents: %v", err)
	}
	defer resp.Body.Close()

	var agents []Agent
	if err := json.NewDecoder(resp.Body).Decode(&agents); err != nil {
		t.Fatalf("decode agents: %v", err)
	}
	if len(agents) == 0 {
		t.Skip("no agents registered on live server — run `npm run setup` first")
	}

	// Build a list of IDs to hit, cycling through available agents up to nAgents.
	ids := make([]int64, nAgents)
	for i := range nAgents {
		ids[i] = agents[i%len(agents)].ID
	}

	t.Logf("hitting %d distinct agents (cycling %d registered)", len(agents), len(agents))

	start := time.Now()
	latencies, errCount := runLoad(t, apiURL, ids)
	wall := time.Since(start)

	printStats(t, "live Ollama — real model latency", wall, latencies, errCount, nAgents)
	if errCount > nAgents/10 { // tolerate up to 10% errors on a live server
		t.Errorf("%d / %d requests failed (>10%% threshold)", errCount, nAgents)
	}
}
