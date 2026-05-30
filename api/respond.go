package main

import (
	"encoding/json"
	"net/http"
)

func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func errResponse(w http.ResponseWriter, status int, msg string) {
	respond(w, status, map[string]string{"error": msg})
}
