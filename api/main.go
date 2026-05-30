package main

import (
	"log/slog"
	"net/http"
	"os"
)

func main() {
	initLogger()

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "contracts.db"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	db, err := initDB(dbPath)
	if err != nil {
		slog.Error("failed to open database", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	h := &handler{
		db:     db,
		ollama: newOllamaClient(),
		loops:  NewLoopRegistry(),
	}

	mux := http.NewServeMux()

	// Contracts
	mux.HandleFunc("POST /contracts",             h.putContract)
	mux.HandleFunc("GET /contracts",              h.listContractsHandler)
	mux.HandleFunc("GET /contracts/{address}",    h.getContractHandler)
	mux.HandleFunc("DELETE /contracts/{id}",      h.deleteContractHandler)
	mux.HandleFunc("PATCH /contracts/{id}",       h.renameContractHandler)

	// Actions
	mux.HandleFunc("POST /actions",        h.createActionHandler)
	mux.HandleFunc("GET /actions",         h.listActionsHandler)
	mux.HandleFunc("GET /actions/{id}",    h.getActionHandler)
	mux.HandleFunc("DELETE /actions/{id}", h.deleteActionHandler)

	// Statuses
	mux.HandleFunc("POST /statuses",     h.createStatusHandler)
	mux.HandleFunc("GET /statuses",      h.listStatusesHandler)
	mux.HandleFunc("GET /statuses/{id}", h.getStatusHandler)

	// Agents
	mux.HandleFunc("POST /agents",                h.createAgentHandler)
	mux.HandleFunc("GET /agents",                 h.listAgentsHandler)
	mux.HandleFunc("GET /agents/{id}",            h.getAgentHandler)
	mux.HandleFunc("POST /agents/{id}/duplicate", h.duplicateAgentHandler)
	mux.HandleFunc("POST /agents/{id}/run",       h.runAgentHandler)

	// Agent loops
	mux.HandleFunc("POST /agents/{id}/loop/start", h.startLoopHandler)
	mux.HandleFunc("POST /agents/{id}/loop/stop",  h.stopLoopHandler)
	mux.HandleFunc("GET /agents/{id}/loop/status", h.loopStatusHandler)
	mux.HandleFunc("POST /agents/{id}/loop/tick",  h.loopTickHandler)
	mux.HandleFunc("GET /loops",                   h.listLoopsHandler)

	// Logs
	mux.HandleFunc("GET /logs", h.listLogsHandler)

	slog.Info("API ready", "port", port, "db", dbPath,
		"ollama", h.ollama.BaseURL, "model", h.ollama.Model)
	if err := http.ListenAndServe(":"+port, corsMiddleware(mux)); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}

// corsMiddleware allows the React dev server (port 5173) to call the API.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
