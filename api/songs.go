package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type Song struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Artist      string `json:"artist"`
	Album       string `json:"album"`
	ReleaseDate string `json:"releaseDate"` // YYYY-MM-DD or YYYY
	Duration    int    `json:"duration"`    // seconds
	Genre       string `json:"genre"`
	ImageURL    string `json:"imageUrl"`
	CreatedAt   string `json:"createdAt"`
}

// SongInput is the write shape — no id or createdAt.
// Accepts snake_case keys (image_url, release_date) since that's the natural
// POST format; responses use the camelCase Song struct.
type SongInput struct {
	Name        string `json:"name"`
	Artist      string `json:"artist"`
	Album       string `json:"album"`
	ReleaseDate string `json:"release_date"`
	Duration    int    `json:"duration"`
	Genre       string `json:"genre"`
	ImageURL    string `json:"image_url"`
}

// ── DB methods ────────────────────────────────────────────────────────────────

func (db *DB) bulkInsertSongs(songs []SongInput) ([]Song, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck

	stmt, err := tx.Prepare(`
		INSERT INTO songs (name, artist, album, release_date, duration, genre, image_url)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return nil, err
	}
	defer stmt.Close()

	ids := make([]int64, 0, len(songs))
	for _, s := range songs {
		res, err := stmt.Exec(s.Name, s.Artist, s.Album, s.ReleaseDate, s.Duration, s.Genre, s.ImageURL)
		if err != nil {
			return nil, err
		}
		id, _ := res.LastInsertId()
		ids = append(ids, id)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	// Fetch inserted rows to return full records with id + created_at.
	out := make([]Song, 0, len(ids))
	for _, id := range ids {
		s, err := db.songByID(id)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

func (db *DB) songByID(id int64) (Song, error) {
	var s Song
	err := db.QueryRow(`
		SELECT id, name, artist, album, release_date, duration, genre, image_url, created_at
		FROM songs WHERE id = ?
	`, id).Scan(&s.ID, &s.Name, &s.Artist, &s.Album, &s.ReleaseDate, &s.Duration, &s.Genre, &s.ImageURL, &s.CreatedAt)
	return s, err
}

// searchSongs returns up to limit random songs matching the given filters.
// All filter fields are optional — empty string / zero = ignored.
func (db *DB) searchSongs(f songFilter) ([]Song, error) {
	where := []string{"1=1"}
	args := []any{}

	if f.Name != "" {
		where = append(where, "name LIKE ?")
		args = append(args, "%"+f.Name+"%")
	}
	if f.Artist != "" {
		where = append(where, "artist LIKE ?")
		args = append(args, "%"+f.Artist+"%")
	}
	if f.Album != "" {
		where = append(where, "album LIKE ?")
		args = append(args, "%"+f.Album+"%")
	}
	if f.Genre != "" {
		where = append(where, "genre LIKE ?")
		args = append(args, "%"+f.Genre+"%")
	}
	if f.From != "" {
		where = append(where, "release_date >= ?")
		args = append(args, f.From)
	}
	if f.To != "" {
		where = append(where, "release_date <= ?")
		args = append(args, f.To)
	}
	if f.MinDuration > 0 {
		where = append(where, "duration >= ?")
		args = append(args, f.MinDuration)
	}
	if f.MaxDuration > 0 {
		where = append(where, "duration <= ?")
		args = append(args, f.MaxDuration)
	}

	limit := f.Limit

	clause := strings.Join(where, " AND ")
	var q string
	if limit > 0 {
		q = fmt.Sprintf(`
			SELECT id, name, artist, album, release_date, duration, genre, image_url, created_at
			FROM songs WHERE %s ORDER BY RANDOM() LIMIT ?`, clause)
		args = append(args, limit)
	} else {
		q = fmt.Sprintf(`
			SELECT id, name, artist, album, release_date, duration, genre, image_url, created_at
			FROM songs WHERE %s ORDER BY id`, clause)
	}

	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Song
	for rows.Next() {
		var s Song
		if err := rows.Scan(&s.ID, &s.Name, &s.Artist, &s.Album, &s.ReleaseDate, &s.Duration, &s.Genre, &s.ImageURL, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	if out == nil {
		out = []Song{}
	}
	return out, rows.Err()
}

type songFilter struct {
	Name        string
	Artist      string
	Album       string
	Genre       string
	From        string // release_date >=
	To          string // release_date <=
	MinDuration int    // seconds >=
	MaxDuration int    // seconds <=
	Limit       int    // 0 → random 1–20
}

func (db *DB) distinctSongColumn(col string) ([]string, error) {
	rows, err := db.Query(fmt.Sprintf(
		`SELECT DISTINCT %s FROM songs WHERE %s != '' ORDER BY %s`, col, col, col,
	))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	if out == nil {
		out = []string{}
	}
	return out, rows.Err()
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// POST /songs
// Body: single SongInput or array of SongInput.
// Returns the inserted songs with their assigned IDs.
func (h *handler) createSongsHandler(w http.ResponseWriter, r *http.Request) {
	body := json.NewDecoder(r.Body)

	// Accept both a single object and an array.
	var inputs []SongInput
	var peek json.RawMessage
	if err := body.Decode(&peek); err != nil {
		errResponse(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if len(peek) > 0 && peek[0] == '[' {
		if err := json.Unmarshal(peek, &inputs); err != nil {
			errResponse(w, http.StatusBadRequest, "invalid JSON array: "+err.Error())
			return
		}
	} else {
		var s SongInput
		if err := json.Unmarshal(peek, &s); err != nil {
			errResponse(w, http.StatusBadRequest, "invalid JSON object: "+err.Error())
			return
		}
		inputs = []SongInput{s}
	}

	if len(inputs) == 0 {
		errResponse(w, http.StatusBadRequest, "no songs provided")
		return
	}
	for i, s := range inputs {
		if s.Name == "" || s.Artist == "" {
			errResponse(w, http.StatusBadRequest, fmt.Sprintf("song[%d]: name and artist are required", i))
			return
		}
	}

	songs, err := h.db.bulkInsertSongs(inputs)
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Info("songs inserted", "count", len(songs))
	respond(w, http.StatusCreated, songs)
}

// GET /songs
// Optional query params: name, artist, album, genre, year, from, to,
//
//	min_duration, max_duration, limit.
//
// Returns a random selection of matching songs.
func (h *handler) searchSongsHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	f := songFilter{
		Name:   q.Get("name"),
		Artist: q.Get("artist"),
		Album:  q.Get("album"),
		Genre:  q.Get("genre"),
		From:   q.Get("from"),
		To:     q.Get("to"),
	}

	// ?year=2025  is shorthand for from=2025-01-01&to=2025-12-31
	if y := q.Get("year"); y != "" && f.From == "" && f.To == "" {
		f.From = y + "-01-01"
		f.To = y + "-12-31"
	}

	if v := q.Get("min_duration"); v != "" {
		f.MinDuration, _ = strconv.Atoi(v)
	}
	if v := q.Get("max_duration"); v != "" {
		f.MaxDuration, _ = strconv.Atoi(v)
	}
	if v := q.Get("limit"); v != "" {
		f.Limit, _ = strconv.Atoi(v)
	}

	songs, err := h.db.searchSongs(f)
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, songs)
}

// GET /songs/genres  — distinct genre values
func (h *handler) listGenresHandler(w http.ResponseWriter, r *http.Request) {
	vals, err := h.db.distinctSongColumn("genre")
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, vals)
}

// GET /songs/albums  — distinct album values; optional ?artist= filter
func (h *handler) listAlbumsHandler(w http.ResponseWriter, r *http.Request) {
	if artist := r.URL.Query().Get("artist"); artist != "" {
		rows, err := h.db.Query(
			`SELECT DISTINCT album FROM songs WHERE artist LIKE ? AND album != '' ORDER BY album`,
			"%"+artist+"%",
		)
		if err != nil {
			errResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var v string
			rows.Scan(&v) //nolint:errcheck
			out = append(out, v)
		}
		if out == nil {
			out = []string{}
		}
		respond(w, http.StatusOK, out)
		return
	}
	vals, err := h.db.distinctSongColumn("album")
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, vals)
}

// GET /songs/artists  — distinct artist values
func (h *handler) listArtistsHandler(w http.ResponseWriter, r *http.Request) {
	vals, err := h.db.distinctSongColumn("artist")
	if err != nil {
		errResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	respond(w, http.StatusOK, vals)
}
