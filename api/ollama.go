package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

const defaultOllamaURL = "http://localhost:11434"

// qwen3:1.7b reliably picks an action from an enum-constrained schema in ~1-2s
// once warm. qwen3:0.6b is ~2x faster (closer to the 0.5s target) but less
// reliable on the open/resolve distinction — override with OLLAMA_MODEL to trade
// speed for accuracy. The runner's simulate-before-send guard means a wrong pick
// is skipped rather than fatal, so either model keeps the system from failing.
const defaultOllamaModel = "qwen3:1.7b"

// keepAlive keeps the model resident between ticks so we pay the load cost once.
const defaultKeepAlive = "30m"

type OllamaClient struct {
	BaseURL string
	Model   string
	http    *http.Client
}

func newOllamaClient() *OllamaClient {
	url := os.Getenv("OLLAMA_URL")
	if url == "" {
		url = defaultOllamaURL
	}
	model := os.Getenv("OLLAMA_MODEL")
	if model == "" {
		model = defaultOllamaModel
	}
	return &OllamaClient{
		BaseURL: url,
		Model:   model,
		http:    &http.Client{Timeout: 120 * time.Second},
	}
}

// ── Chat structures ───────────────────────────────────────────────────────────

type OllamaMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type OllamaChatRequest struct {
	Model     string          `json:"model"`
	Messages  []OllamaMessage `json:"messages"`
	Stream    bool            `json:"stream"`
	Think     bool            `json:"think"`            // false = disable Qwen3 thinking mode
	Format    json.RawMessage `json:"format,omitempty"` // JSON schema → grammar-constrained output
	KeepAlive string          `json:"keep_alive,omitempty"`
	Options   map[string]any  `json:"options,omitempty"` // model-level options
}

type OllamaChatResponse struct {
	Model   string        `json:"model"`
	Message OllamaMessage `json:"message"`
	Done    bool          `json:"done"`
}

func (c *OllamaClient) Chat(req OllamaChatRequest) (OllamaChatResponse, error) {
	req.Model = c.Model
	req.Stream = false
	if req.KeepAlive == "" {
		req.KeepAlive = defaultKeepAlive
	}

	body, err := json.Marshal(req)
	if err != nil {
		return OllamaChatResponse{}, err
	}

	resp, err := c.http.Post(c.BaseURL+"/api/chat", "application/json", bytes.NewReader(body))
	if err != nil {
		return OllamaChatResponse{}, fmt.Errorf("ollama unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var e map[string]any
		json.NewDecoder(resp.Body).Decode(&e)
		return OllamaChatResponse{}, fmt.Errorf("ollama %d: %v", resp.StatusCode, e)
	}

	var result OllamaChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return OllamaChatResponse{}, err
	}
	return result, nil
}
