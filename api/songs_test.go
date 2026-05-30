package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ── Fixtures ──────────────────────────────────────────────────────────────────

var testSongs = []SongInput{
	{"Con Otra", "Cazzu", "Nena Trampa", "2023-09-01", 198, "Trap/Urbano", ""},
	{"Baile Inolvidable", "Bad Bunny", "Nadie Sabe Lo Que Va a Pasar Mañana", "2023-10-13", 217, "Reggaeton", ""},
	{"Si Antes Te Hubiera Conocido", "Karol G", "Mañana Será Bonito", "2023-02-24", 194, "Reggaeton", ""},
	{"Blackout", "Emilia", "Emilia", "2024-04-05", 165, "Pop/Urbano", ""},
	{"Cae El Sol", "Airbag", "El Último Vals", "2022-06-10", 243, "Rock", ""},
	{"Ella Dijo", "Estelares", "El Hombre Que Siente", "2022-08-20", 231, "Rock", ""},
	{"Lose Control", "Teddy Swims", "I've Tried Everything But Therapy", "2024-01-19", 195, "R&B/Pop", ""},
	{"The Fate of Ophelia", "Taylor Swift", "The Tortured Poets Department", "2024-04-19", 228, "Pop", ""},
	{"Amor De Vago", "La T y La M", "Cuarteto Nacional", "2024-03-15", 185, "Cuarteto/Cumbia", ""},
	{"Starboy Remix", "DUKI", "Antes de Ameri", "2023-07-07", 203, "Trap", ""},
}

func songsServer(t *testing.T) (*DB, *httptest.Server) {
	t.Helper()
	db := testDB(t)
	h := &handler{db: db, ollama: nil, loops: NewLoopRegistry()}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /songs", h.createSongsHandler)
	mux.HandleFunc("GET /songs", h.searchSongsHandler)
	mux.HandleFunc("GET /songs/genres", h.listGenresHandler)
	mux.HandleFunc("GET /songs/albums", h.listAlbumsHandler)
	mux.HandleFunc("GET /songs/artists", h.listArtistsHandler)
	return db, httptest.NewServer(mux)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

func TestCreateSongs(t *testing.T) {
	_, srv := songsServer(t)
	defer srv.Close()

	body, _ := json.Marshal(testSongs)
	resp, err := http.Post(srv.URL+"/songs", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}

	var got []Song
	json.NewDecoder(resp.Body).Decode(&got)
	if len(got) != len(testSongs) {
		t.Fatalf("inserted %d, want %d", len(got), len(testSongs))
	}
	for _, s := range got {
		if s.ID == 0 {
			t.Errorf("song %q has id=0", s.Name)
		}
	}
}

func TestCreateSongSingle(t *testing.T) {
	_, srv := songsServer(t)
	defer srv.Close()

	single := testSongs[0]
	body, _ := json.Marshal(single)
	resp, err := http.Post(srv.URL+"/songs", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	var got []Song
	json.NewDecoder(resp.Body).Decode(&got)
	if len(got) != 1 || got[0].Name != single.Name {
		t.Errorf("got %+v, want single song %q", got, single.Name)
	}
}

func TestSearchSongsNoFilter(t *testing.T) {
	_, srv := songsServer(t)
	defer srv.Close()

	seedSongs(t, srv)

	resp, err := http.Get(srv.URL + "/songs")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var got []Song
	json.NewDecoder(resp.Body).Decode(&got)
	if len(got) != len(testSongs) {
		t.Errorf("expected all %d songs, got %d", len(testSongs), len(got))
	}
}

func TestSearchSongsFilters(t *testing.T) {
	_, srv := songsServer(t)
	defer srv.Close()
	seedSongs(t, srv)

	cases := []struct {
		query   string
		checkFn func([]Song) bool
		desc    string
	}{
		{
			"?genre=Reggaeton&limit=10",
			func(s []Song) bool {
				for _, song := range s {
					if song.Genre != "Reggaeton" {
						return false
					}
				}
				return len(s) == 2
			},
			"genre=Reggaeton returns only reggaeton songs",
		},
		{
			"?year=2024&limit=10",
			func(s []Song) bool {
				for _, song := range s {
					if song.ReleaseDate[:4] != "2024" {
						return false
					}
				}
				return len(s) > 0
			},
			"year=2024 returns only 2024 songs",
		},
		{
			"?genre=Rock&limit=10",
			func(s []Song) bool { return len(s) == 2 },
			"genre=Rock returns 2 songs",
		},
		{
			"?name=baile&limit=10",
			func(s []Song) bool { return len(s) == 1 && s[0].Artist == "Bad Bunny" },
			"name like 'baile' matches Baile Inolvidable",
		},
		{
			"?artist=taylor&limit=10",
			func(s []Song) bool { return len(s) == 1 && s[0].Name == "The Fate of Ophelia" },
			"artist like 'taylor' finds Taylor Swift",
		},
		{
			"?from=2024-01-01&to=2024-12-31&limit=10",
			func(s []Song) bool {
				for _, song := range s {
					if song.ReleaseDate < "2024-01-01" || song.ReleaseDate > "2024-12-31" {
						return false
					}
				}
				return len(s) > 0
			},
			"date range 2024 returns only 2024 songs",
		},
		{
			"?min_duration=200&limit=10",
			func(s []Song) bool {
				for _, song := range s {
					if song.Duration < 200 {
						return false
					}
				}
				return len(s) > 0
			},
			"min_duration=200 returns only long songs",
		},
	}

	for _, tc := range cases {
		t.Run(tc.desc, func(t *testing.T) {
			resp, err := http.Get(srv.URL + "/songs" + tc.query)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			var got []Song
			json.NewDecoder(resp.Body).Decode(&got)
			if !tc.checkFn(got) {
				t.Errorf("filter %q: unexpected results: %+v", tc.query, got)
			}
		})
	}
}

func TestListGenresAlbumsArtists(t *testing.T) {
	_, srv := songsServer(t)
	defer srv.Close()
	seedSongs(t, srv)

	for _, endpoint := range []string{"/songs/genres", "/songs/albums", "/songs/artists"} {
		resp, err := http.Get(srv.URL + endpoint)
		if err != nil {
			t.Fatalf("%s: %v", endpoint, err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("%s: status = %d", endpoint, resp.StatusCode)
		}
		var vals []string
		json.NewDecoder(resp.Body).Decode(&vals)
		if len(vals) == 0 {
			t.Errorf("%s: expected non-empty list", endpoint)
		}
	}
}

func TestListAlbumsFilteredByArtist(t *testing.T) {
	_, srv := songsServer(t)
	defer srv.Close()
	seedSongs(t, srv)

	resp, err := http.Get(srv.URL + "/songs/albums?artist=bad+bunny")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var albums []string
	json.NewDecoder(resp.Body).Decode(&albums)
	if len(albums) != 1 {
		t.Errorf("expected 1 album for Bad Bunny, got %v", albums)
	}
}

func seedSongs(t *testing.T, srv *httptest.Server) {
	t.Helper()
	body, _ := json.Marshal(testSongs)
	resp, err := http.Post(srv.URL+"/songs", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	resp.Body.Close()
}
