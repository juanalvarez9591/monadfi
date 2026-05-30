package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"
)

// ── In-memory log ring buffer ─────────────────────────────────────────────────

type LogEntry struct {
	Time  string         `json:"time"`
	Level string         `json:"level"`
	Msg   string         `json:"msg"`
	Attrs map[string]any `json:"attrs,omitempty"`
}

type LogBuffer struct {
	mu      sync.RWMutex
	entries []LogEntry
	max     int
}

func NewLogBuffer(max int) *LogBuffer { return &LogBuffer{max: max} }

func (b *LogBuffer) add(e LogEntry) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.entries = append(b.entries, e)
	if len(b.entries) > b.max {
		b.entries = b.entries[len(b.entries)-b.max:]
	}
}

func (b *LogBuffer) recent(n int) []LogEntry {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if n <= 0 || n > len(b.entries) {
		n = len(b.entries)
	}
	out := make([]LogEntry, n)
	copy(out, b.entries[len(b.entries)-n:])
	return out
}

// ── TeeHandler: writes to stderr (JSON) and the ring buffer ───────────────────

type TeeHandler struct {
	json slog.Handler
	buf  *LogBuffer
}

func (h *TeeHandler) Enabled(ctx context.Context, l slog.Level) bool {
	return h.json.Enabled(ctx, l)
}

func (h *TeeHandler) Handle(ctx context.Context, r slog.Record) error {
	// Capture attrs into a map for the buffer
	attrs := map[string]any{}
	r.Attrs(func(a slog.Attr) bool {
		attrs[a.Key] = a.Value.Any()
		return true
	})
	h.buf.add(LogEntry{
		Time:  r.Time.UTC().Format(time.RFC3339),
		Level: r.Level.String(),
		Msg:   r.Message,
		Attrs: attrs,
	})
	return h.json.Handle(ctx, r)
}

func (h *TeeHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &TeeHandler{json: h.json.WithAttrs(attrs), buf: h.buf}
}

func (h *TeeHandler) WithGroup(name string) slog.Handler {
	return &TeeHandler{json: h.json.WithGroup(name), buf: h.buf}
}

// Global buffer — set in main, read by the logs handler
var globalLogBuf = NewLogBuffer(500)

func initLogger() {
	jsonH := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})
	slog.SetDefault(slog.New(&TeeHandler{json: jsonH, buf: globalLogBuf}))
}

// ── HTTP handler ──────────────────────────────────────────────────────────────

// GET /logs?n=100
func (h *handler) listLogsHandler(w http.ResponseWriter, r *http.Request) {
	n := 100
	if q := r.URL.Query().Get("n"); q != "" {
		if parsed := 0; json.Unmarshal([]byte(q), &parsed) == nil && parsed > 0 {
			n = parsed
		}
	}
	entries := globalLogBuf.recent(n)
	if entries == nil {
		entries = []LogEntry{}
	}
	respond(w, http.StatusOK, entries)
}
