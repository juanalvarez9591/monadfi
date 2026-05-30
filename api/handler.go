package main

type handler struct {
	db     *DB
	ollama *OllamaClient
	loops  *LoopRegistry
}
