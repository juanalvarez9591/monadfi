package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// ── Curator playlists ─────────────────────────────────────────────────────────

type curatorDef struct {
	tag    string   // keyword embedded in system prompt for mock detection
	name   string   // playlist display name
	genres []string // preferred genre substrings (checked against song.genre)
}

// 5 curators × 10 picks each = 50 songs, perfect partition.
// Genres are matched as substrings against billboardSong.genre.
// vibe_curator has no genre preference and takes whatever remains last.
var curators = []curatorDef{
	{"cuarteto_curator", "Noche de Cuarteto", []string{"Cuarteto", "Cumbia"}},
	{"trap_curator", "Trap y Calle", []string{"Trap", "Rap"}},
	{"reggaeton_curator", "Perreo Mode", []string{"Reggaeton", "Urbano Latino"}},
	{"pop_curator", "Pop Hits", []string{"Pop", "R&B", "Latin", "Rock"}},
	{"vibe_curator", "Vibe Mix", []string{}},
}

// songLookup maps "song_N" → &billboardSong for fast genre checks in the mock.
var songLookup = func() map[string]*billboardSong {
	m := make(map[string]*billboardSong, len(chartSongs))
	for i := range chartSongs {
		m[fmt.Sprintf("song_%d", chartSongs[i].pos)] = &chartSongs[i]
	}
	return m
}()

// playlistMockOllama returns a mock Ollama that:
//  1. Detects the curator tag from the system prompt.
//  2. Determines which songs are still available (not yet "PICKED") from the state string.
//  3. Picks the first available song whose genre matches the curator's preferences.
//  4. Falls back to the first available song if no genre match.
func playlistMockOllama() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req OllamaChatRequest
		json.NewDecoder(r.Body).Decode(&req) //nolint:errcheck

		sys, userMsg := "", ""
		for _, m := range req.Messages {
			switch m.Role {
			case "system":
				sys = m.Content
			case "user":
				userMsg = m.Content
			}
		}

		// Detect curator and its genre preferences.
		var genres []string
		for _, c := range curators {
			if strings.Contains(sys, c.tag) {
				genres = c.genres
				break
			}
		}

		// Get valid actions from format schema enum.
		var schema struct {
			Properties struct {
				Action struct{ Enum []string `json:"enum"` } `json:"action"`
			} `json:"properties"`
		}
		json.Unmarshal(req.Format, &schema) //nolint:errcheck
		enum := schema.Properties.Action.Enum

		// Find available (non-PICKED) actions.
		available := make([]string, 0, len(enum))
		for _, action := range enum {
			if action == "wait" {
				continue
			}
			// runAgentHandler encodes Result via json.Marshal, so "PICKED" → `"PICKED"`.
			if strings.Contains(userMsg, action+"=\"PICKED\"") {
				continue
			}
			available = append(available, action)
		}

		// Pick first available song that matches a preferred genre; fall back to first available.
		chosen := ""
		for _, action := range available {
			if len(genres) == 0 {
				break // vibe_curator: skip genre check, take first available
			}
			if song, ok := songLookup[action]; ok {
				for _, g := range genres {
					if strings.Contains(song.genre, g) {
						chosen = action
						break
					}
				}
			}
			if chosen != "" {
				break
			}
		}
		if chosen == "" && len(available) > 0 {
			chosen = available[0]
		}
		if chosen == "" {
			chosen = "wait"
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(OllamaChatResponse{ //nolint:errcheck
			Model:   "qwen3:1.7b",
			Message: OllamaMessage{Role: "assistant", Content: fmt.Sprintf(`{"action":%q}`, chosen)},
			Done:    true,
		})
	}))
}

// TestBillboardSubPlaylists creates 5 curator agents and has each pick 10 songs
// sequentially from a shared pool, producing 5 non-overlapping playlists that
// together cover all 50 chart songs.
//
// Run with:
//
//	go test -v -run TestBillboardSubPlaylists ./api/
func TestBillboardSubPlaylists(t *testing.T) {
	mock := playlistMockOllama()
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

	// Create one action per song (all 50 available to every curator).
	c, err := db.upsertContract("BillboardPlaylistChart", "0xplaylist", `[]`, 31337, "")
	if err != nil {
		t.Fatalf("upsertContract: %v", err)
	}
	actionIDs := make([]int64, len(chartSongs))
	for i, song := range chartSongs {
		fn := fmt.Sprintf("song_%d", song.pos)
		frag := fmt.Sprintf(`{"type":"function","name":%q,"inputs":[],"outputs":[]}`, fn)
		act, err := db.createAction(c.ID, fn, frag, `{}`)
		if err != nil {
			t.Fatalf("createAction %s: %v", fn, err)
		}
		actionIDs[i] = act.ID
	}

	// Create one agent per curator, all with access to all 50 actions.
	curatorAgentIDs := make([]int64, len(curators))
	for i, cur := range curators {
		prompt := fmt.Sprintf(
			"You are a music curator. Theme: %s | %s. "+
				"Pick one song per round from the available chart entries. "+
				"Avoid songs already marked PICKED.",
			cur.name, cur.tag,
		)
		agent, err := db.createAgent(prompt, nil, actionIDs)
		if err != nil {
			t.Fatalf("createAgent (%s): %v", cur.tag, err)
		}
		curatorAgentIDs[i] = agent.ID
	}

	const songsPerPlaylist = 10

	// picked tracks which song actions have already been assigned.
	picked := make(map[string]bool)

	// playlists[i] is the ordered list of songs for curators[i].
	playlists := make([][]*billboardSong, len(curators))

	totalStart := time.Now()

	for ci, cur := range curators {
		for round := 0; round < songsPerPlaylist; round++ {
			// Build state: available songs carry their details; picked ones say "PICKED".
			state := make([]StateEntry, len(chartSongs))
			for si, song := range chartSongs {
				fn := fmt.Sprintf("song_%d", song.pos)
				result := any(fmt.Sprintf("#%d %s — %s (%s)", song.pos, song.title, song.artist, song.genre))
				if picked[fn] {
					result = "PICKED"
				}
				state[si] = StateEntry{FunctionName: fn, Result: result}
			}

			body, _ := json.Marshal(RunRequest{State: state})
			url := fmt.Sprintf("%s/agents/%d/run", srv.URL, curatorAgentIDs[ci])

			resp, err := http.Post(url, "application/json", bytes.NewReader(body))
			if err != nil {
				t.Fatalf("curator %s round %d: %v", cur.tag, round+1, err)
			}
			var rr RunResponse
			json.NewDecoder(resp.Body).Decode(&rr) //nolint:errcheck
			resp.Body.Close()

			if rr.FunctionName == "" || rr.FunctionName == "wait" {
				t.Fatalf("curator %s round %d: no song picked (got %q)", cur.tag, round+1, rr.FunctionName)
			}
			if picked[rr.FunctionName] {
				t.Fatalf("curator %s round %d: picked already-taken song %s", cur.tag, round+1, rr.FunctionName)
			}

			picked[rr.FunctionName] = true
			playlists[ci] = append(playlists[ci], songLookup[rr.FunctionName])
		}
	}

	wall := time.Since(totalStart)

	// ── Print playlists ───────────────────────────────────────────────────────
	t.Logf("")
	t.Logf("══════════════════════════════════════════════════════════════════════")
	t.Logf("        BILLBOARD ARGENTINA HOT 100 — 5 SUB-PLAYLISTS               ")
	t.Logf("        %d songs total  |  %d picks  |  wall time: %s",
		len(chartSongs), len(curators)*songsPerPlaylist, wall.Round(time.Millisecond))
	t.Logf("══════════════════════════════════════════════════════════════════════")

	for ci, cur := range curators {
		t.Logf("")
		t.Logf("  ▶  %s  (%d songs)", cur.name, len(playlists[ci]))
		t.Logf("  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄")
		for rank, song := range playlists[ci] {
			t.Logf("  %2d. #%-3d %-33s %-28s %s",
				rank+1, song.pos,
				truncate(song.title, 33),
				truncate(song.artist, 28),
				song.genre,
			)
		}
	}

	t.Logf("")
	t.Logf("══════════════════════════════════════════════════════════════════════")
	t.Logf("  Coverage: %d / %d songs assigned", len(picked), len(chartSongs))
	t.Logf("══════════════════════════════════════════════════════════════════════")

	if len(picked) != len(chartSongs) {
		t.Errorf("only %d / %d songs were assigned", len(picked), len(chartSongs))
	}
}

// ── Chart data ────────────────────────────────────────────────────────────────

type billboardSong struct {
	pos    int
	title  string
	artist string
	genre  string
}

// Billboard Argentina Hot 100 mock — 50 songs.
var chartSongs = []billboardSong{
	{1, "Con Otra", "Cazzu", "Trap/Urbano"},
	{2, "W Sound 05: La Plena", "W Sound, Beéle & Ovy On The Drums", "Reggaeton"},
	{3, "Blackout", "Emilia, TINI & Nicki Nicole", "Pop/Urbano"},
	{4, "Amor De Vago", "La T y La M ft. Malandro de América", "Cuarteto/Cumbia"},
	{5, "Capaz", "Alleh & Yorghaki", "Urbano Latino"},
	{6, "Si Antes Te Hubiera Conocido", "Karol G", "Reggaeton"},
	{7, "Baile Inolvidable", "Bad Bunny", "Reggaeton"},
	{8, "Bunda", "Emilia & Luísa Sonza", "Pop/Urbano"},
	{9, "Parte & Choke", "Jombriel, Ryan Castro, Jotta & Alex Krack", "Urbano Latino"},
	{10, "Pa Las Girlas", "Mattei", "Urbano/Trap"},
	{11, "Tu Jardín Con Enanitos", "Roze Oficial, Max Carra, Valen & RAMKY", "Cuarteto"},
	{12, "Tu Misterioso Alguien (Cuarteto)", "Luck Ra & Miranda!", "Cuarteto/Pop"},
	{13, "Tu Vas Sin (Fav)", "Rels B", "Pop/Urbano"},
	{14, "Todo Ke Ver", "Jere Klein & Katteyes", "Urbano Latino"},
	{15, "The Fate of Ophelia", "Taylor Swift", "Pop"},
	{16, "La Plena (W Sound 05)", "W Sound, Beéle & Ovy On The Drums", "Reggaeton"},
	{17, "Me Gusta", "Miranda! & TINI", "Pop"},
	{18, "Soleao", "Myke Towers & Quevedo", "Urbano/Trap"},
	{19, "Universidad", "TINI & Beéle", "Pop/Urbano"},
	{20, "Infinitos Como El Mar", "María Becerra & XROSS", "Pop/Urbano"},
	{21, "Ramen Para Dos", "María Becerra, XROSS & Paulo Londra", "Pop/Urbano"},
	{22, "#TETAS", "Ca7riel & Paco Amoroso", "Rap/Trap"},
	{23, "El Día Del Amigo", "Ca7riel & Paco Amoroso", "Rap/Trap"},
	{24, "Starboy Remix", "Zell, DUKI & Neo Pistea", "Trap"},
	{25, "De Papel", "TINI", "Pop"},
	{26, "Si Las Gatas Se Amotinan", "Peipper, Doble P & Locura Mix", "Cuarteto/Cumbia"},
	{27, "Mi Señora", "KHEA, DUKI & La Joaqui", "Trap/Urbano"},
	{28, "Págate", "Standly", "Pop/Urbano"},
	{29, "No Me Importa", "Lali", "Pop"},
	{30, "Deportivo", "Blessd & Anuel AA", "Reggaeton"},
	{31, "Un Finde", "Big One, FMK & Ke Personajes", "Cuarteto"},
	{32, "Ya No Vuelvas", "Luck Ra, La K'onga & Ke Personajes", "Cuarteto/Cumbia"},
	{33, "Marisola (Remix)", "Cris MJ, Duki & Nicki Nicole ft. Standly", "Reggaeton/Trap"},
	{34, "En La Intimidad", "Big One, Emilia & Callejero Fino", "Trap/Urbano"},
	{35, "Universo Paralelo", "La K'onga ft. Nahuel Pennisi", "Cuarteto"},
	{36, "Aventura", "Q'Lokura & Valentina Olguin", "Cuarteto"},
	{37, "Carita Triste", "Q'Lokura & Los Herrera", "Cuarteto"},
	{38, "Lose Control", "Teddy Swims", "R&B/Pop"},
	{39, "The Door", "Teddy Swims", "R&B/Pop"},
	{40, "Dumbai", "Ca7riel & Paco Amoroso", "Rap/Trap"},
	{41, "Inevitable", "Shakira", "Pop/Latin"},
	{42, "Mambinho Brasileño", "Benjitalkapone", "Urbano"},
	{43, "Pobre Corazón", "Ke Personajes & Onda Sabalera", "Cuarteto"},
	{44, "M.A. (Mejores Amigos)", "BM, Callejero Fino & La Joaqui ft. Lola Índigo", "Urbano/Trap"},
	{45, "Muñecas", "Tini, La Joaqui & Steve Aoki", "Pop/Electro"},
	{46, "Cupido", "Tini", "Pop"},
	{47, "Cae El Sol", "Airbag", "Rock"},
	{48, "Un Beso Menos", "Elena Rose & Morat", "Pop/Latin"},
	{49, "Ella Dijo", "Estelares", "Rock"},
	{50, "Tiene", "Tobal MJ & Lucky Brown", "Urbano"},
}

// ── Voter profiles ────────────────────────────────────────────────────────────

type voterProfile struct {
	tag      string // keyword embedded in agent prompt — mock reads this
	label    string
	topSongs []int // preferred song positions in priority order (1-indexed)
}

// 10 profiles × 10 agents each = 100 agents.
// topSongs order matters: voter N within the profile picks topSongs[(N-1) % len(topSongs)].
var voterProfiles = []voterProfile{
	{
		"reggaeton_fan", "Reggaeton Fan",
		[]int{7, 6, 2, 30, 16},
	},
	{
		"cuarteto_fan", "Cuarteto Fan",
		[]int{4, 11, 12, 31, 32, 35, 36, 37, 43, 26},
	},
	{
		"trap_fan", "Trap Fan",
		[]int{1, 24, 27, 22, 23, 40, 10, 34},
	},
	{
		"pop_fan", "Pop Fan",
		[]int{3, 15, 8, 17, 25, 29, 45, 46, 19, 20},
	},
	{
		"urbano_fan", "Urbano Fan",
		[]int{5, 9, 14, 18, 21, 28, 42, 50},
	},
	{
		"rock_fan", "Rock Fan",
		[]int{47, 49, 47, 49, 47, 49, 47, 49, 47, 49}, // only two rock songs
	},
	{
		"rnb_fan", "R&B Fan",
		[]int{38, 39, 38, 39, 38, 39, 38, 39, 38, 39}, // only two R&B songs
	},
	{
		"latin_pop_fan", "Latin Pop Fan",
		[]int{41, 48, 25, 17, 29, 46, 41, 48, 25, 17},
	},
	{
		"omnivore_fan", "Omnivore Fan",
		[]int{1, 3, 7, 6, 22, 15, 2, 8, 23, 29},
	},
	{
		"argentina_fan", "Argentina Fan",
		[]int{1, 3, 4, 22, 24, 47, 49, 11, 12, 27},
	},
}

const agentsPerVoterProfile = 10 // 10 × 10 = 100

// ── Mock Ollama ───────────────────────────────────────────────────────────────

// billboardMockOllama returns an httptest.Server that reads the voter profile tag
// and voter index from the agent's system prompt, then returns the corresponding
// preferred song as the action.
func billboardMockOllama() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req OllamaChatRequest
		json.NewDecoder(r.Body).Decode(&req) //nolint:errcheck

		sys := ""
		if len(req.Messages) > 0 && req.Messages[0].Role == "system" {
			sys = req.Messages[0].Content
		}

		// Detect voter profile from system prompt keyword.
		var prof *voterProfile
		for i := range voterProfiles {
			if strings.Contains(sys, voterProfiles[i].tag) {
				prof = &voterProfiles[i]
				break
			}
		}

		// Extract voter index: prompt contains "|voter_idx:N|".
		voterIdx := 0
		if idx := strings.Index(sys, "|voter_idx:"); idx >= 0 {
			fmt.Sscanf(sys[idx:], "|voter_idx:%d|", &voterIdx) //nolint:errcheck
		}

		action := "wait"
		if prof != nil {
			pick := prof.topSongs[(voterIdx) % len(prof.topSongs)]
			action = fmt.Sprintf("song_%d", pick)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(OllamaChatResponse{ //nolint:errcheck
			Model:   "qwen3:1.7b",
			Message: OllamaMessage{Role: "assistant", Content: fmt.Sprintf(`{"action":%q}`, action)},
			Done:    true,
		})
	}))
}

// ── Test ──────────────────────────────────────────────────────────────────────

// TestBillboard100AgentVote seeds 100 agents (10 voter profiles × 10 each),
// fires them all concurrently against the real handler, and prints the top 5
// voted songs from the Billboard Argentina Hot 100.
//
// Run with:
//
//	go test -v -run TestBillboard100AgentVote ./api/
func TestBillboard100AgentVote(t *testing.T) {
	mock := billboardMockOllama()
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

	// ── Create one action per song ────────────────────────────────────────────
	c, err := db.upsertContract("BillboardArgentinaHot100", "0xbillboard", `[]`, 31337, "")
	if err != nil {
		t.Fatalf("upsertContract: %v", err)
	}
	actionIDs := make([]int64, len(chartSongs))
	for i, song := range chartSongs {
		fnName := fmt.Sprintf("song_%d", song.pos)
		fragment := fmt.Sprintf(`{"type":"function","name":%q,"inputs":[],"outputs":[]}`, fnName)
		act, err := db.createAction(c.ID, fnName, fragment, `{}`)
		if err != nil {
			t.Fatalf("createAction %s: %v", fnName, err)
		}
		actionIDs[i] = act.ID
	}

	// ── Create 100 agents ─────────────────────────────────────────────────────
	type agentMeta struct {
		id      int64
		profile *voterProfile
		voterN  int // 0-indexed within profile
	}
	agentMetas := make([]agentMeta, 0, 100)
	for pi := range voterProfiles {
		for n := 0; n < agentsPerVoterProfile; n++ {
			p := &voterProfiles[pi]
			prompt := fmt.Sprintf(
				"You are a music listener. Profile: %s | %s | |voter_idx:%d| "+
					"Vote for your single favorite song from the Billboard Argentina Hot 100 "+
					"by choosing the corresponding song action.",
				p.label, p.tag, n,
			)
			agent, err := db.createAgent(prompt, nil, actionIDs)
			if err != nil {
				t.Fatalf("createAgent (%s #%d): %v", p.tag, n, err)
			}
			agentMetas = append(agentMetas, agentMeta{id: agent.ID, profile: p, voterN: n})
		}
	}

	// ── Build state: pass the full chart as context ───────────────────────────
	state := make([]StateEntry, len(chartSongs))
	for i, song := range chartSongs {
		state[i] = StateEntry{
			FunctionName: fmt.Sprintf("song_%d", song.pos),
			Result:       fmt.Sprintf("#%d %s — %s (%s)", song.pos, song.title, song.artist, song.genre),
		}
	}
	reqBody, _ := json.Marshal(RunRequest{State: state})

	// ── Fire 100 concurrent requests ──────────────────────────────────────────
	type voteResult struct {
		meta   agentMeta
		action string
		d      time.Duration
		err    error
	}
	results := make([]voteResult, len(agentMetas))
	var wg sync.WaitGroup
	wg.Add(len(agentMetas))

	wallStart := time.Now()
	for i, am := range agentMetas {
		go func(idx int, meta agentMeta) {
			defer wg.Done()
			url := fmt.Sprintf("%s/agents/%d/run", srv.URL, meta.id)
			t0 := time.Now()
			resp, err := http.Post(url, "application/json", bytes.NewReader(reqBody))
			d := time.Since(t0)
			if err != nil {
				results[idx] = voteResult{meta: meta, err: err, d: d}
				return
			}
			defer resp.Body.Close()
			var rr RunResponse
			json.NewDecoder(resp.Body).Decode(&rr) //nolint:errcheck
			results[idx] = voteResult{meta: meta, action: rr.FunctionName, d: d}
		}(i, am)
	}
	wg.Wait()
	wall := time.Since(wallStart)

	// ── Tally votes ───────────────────────────────────────────────────────────
	votes := make(map[string]int)         // action → vote count
	byProfile := make(map[string]string)  // profile.tag → chosen action (last seen; all same)
	var errCount int
	latencies := make([]time.Duration, 0, len(agentMetas))

	for _, r := range results {
		if r.err != nil || r.action == "" {
			errCount++
			continue
		}
		votes[r.action]++
		byProfile[r.meta.profile.tag] = r.action
		latencies = append(latencies, r.d)
	}

	// ── Sort songs by vote count ──────────────────────────────────────────────
	type tally struct {
		action string
		count  int
		song   *billboardSong
	}
	tallies := make([]tally, 0, len(votes))
	for action, count := range votes {
		var matched *billboardSong
		for i := range chartSongs {
			if fmt.Sprintf("song_%d", chartSongs[i].pos) == action {
				matched = &chartSongs[i]
				break
			}
		}
		tallies = append(tallies, tally{action: action, count: count, song: matched})
	}
	sort.Slice(tallies, func(i, j int) bool {
		if tallies[i].count != tallies[j].count {
			return tallies[i].count > tallies[j].count
		}
		if tallies[i].song != nil && tallies[j].song != nil {
			return tallies[i].song.pos < tallies[j].song.pos
		}
		return tallies[i].action < tallies[j].action
	})

	// ── Latency stats ─────────────────────────────────────────────────────────
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	pct := func(p float64) time.Duration {
		if len(latencies) == 0 {
			return 0
		}
		return latencies[int(float64(len(latencies)-1)*p/100)]
	}

	// ── Per-agent table (sorted by latency) ───────────────────────────────────
	// Sort results by latency for the table.
	sortedResults := make([]voteResult, len(results))
	copy(sortedResults, results)
	sort.Slice(sortedResults, func(i, j int) bool {
		return sortedResults[i].d < sortedResults[j].d
	})

	t.Logf("")
	t.Logf("  PER-AGENT RESPONSE TIMES (sorted fastest → slowest)")
	t.Logf("  %-6s  %-18s  %-8s  %-30s  %s", "Agent", "Profile", "ms", "Voted for", "Status")
	t.Logf("  ──────────────────────────────────────────────────────────────────────────")
	for _, r := range sortedResults {
		status := "OK"
		if r.err != nil {
			status = "ERR: " + r.err.Error()
		} else if r.action == "" {
			status = "no-op (wait)"
		}
		songLabel := r.action
		for i := range chartSongs {
			if fmt.Sprintf("song_%d", chartSongs[i].pos) == r.action {
				songLabel = fmt.Sprintf("#%d %s", chartSongs[i].pos, truncate(chartSongs[i].title, 22))
				break
			}
		}
		t.Logf("  %-6d  %-18s  %8.2f  %-30s  %s",
			r.meta.id,
			truncate(r.meta.profile.label, 18),
			float64(r.d.Microseconds())/1000.0,
			songLabel,
			status,
		)
	}
	t.Logf("  ──────────────────────────────────────────────────────────────────────────")

	// ── Print results ─────────────────────────────────────────────────────────
	t.Logf("")
	t.Logf("══════════════════════════════════════════════════════════════════")
	t.Logf("        BILLBOARD ARGENTINA HOT 100 — 100 AGENT VOTE             ")
	t.Logf("══════════════════════════════════════════════════════════════════")
	t.Logf("  Agents: %d  |  Errors: %d  |  Wall time: %s",
		len(agentMetas), errCount, wall.Round(time.Millisecond))
	t.Logf("  Latency — p50: %s  p95: %s  p99: %s",
		pct(50).Round(time.Microsecond), pct(95).Round(time.Microsecond), pct(99).Round(time.Microsecond))
	t.Logf("")
	t.Logf("  ★  TOP 5  ★")
	t.Logf("  ─────────────────────────────────────────────────────────────")
	medals := []string{"🥇", "🥈", "🥉", "  4.", "  5."}
	for rank, tl := range tallies {
		if rank >= 5 {
			break
		}
		medal := medals[rank]
		if tl.song != nil {
			t.Logf("  %s  %-35s %-28s  %2d votes",
				medal,
				truncate(tl.song.title, 35),
				truncate(tl.song.artist, 28),
				tl.count,
			)
			t.Logf("       Genre: %-20s   Chart position: #%d", tl.song.genre, tl.song.pos)
		} else {
			t.Logf("  %s  %s  [%d votes]", medal, tl.action, tl.count)
		}
		t.Logf("  ─────────────────────────────────────────────────────────────")
	}
	t.Logf("")
	t.Logf("  PROFILE BREAKDOWN  (%d agents per profile)", agentsPerVoterProfile)
	t.Logf("  ─────────────────────────────────────────────────────────────")
	// Count votes per profile
	profileVotes := make(map[string]map[string]int) // profile.tag → action → count
	for _, r := range results {
		if r.err != nil || r.action == "" {
			continue
		}
		if profileVotes[r.meta.profile.tag] == nil {
			profileVotes[r.meta.profile.tag] = make(map[string]int)
		}
		profileVotes[r.meta.profile.tag][r.action]++
	}
	for _, p := range voterProfiles {
		pv := profileVotes[p.tag]
		// Find top pick for this profile
		topAction, topCount := "", 0
		for action, count := range pv {
			if count > topCount {
				topAction, topCount = action, count
			}
		}
		songLabel := topAction
		for i := range chartSongs {
			if fmt.Sprintf("song_%d", chartSongs[i].pos) == topAction {
				songLabel = fmt.Sprintf("%s — %s", chartSongs[i].title, chartSongs[i].artist)
				break
			}
		}
		t.Logf("  %-18s → %s (%d votes)", p.label, truncate(songLabel, 45), topCount)
	}
	t.Logf("══════════════════════════════════════════════════════════════════")

	if errCount > len(agentMetas)/10 {
		t.Errorf("%d / %d agents failed (>10%% threshold)", errCount, len(agentMetas))
	}
}
