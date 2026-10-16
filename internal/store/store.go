package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"

	"github.com/Nelcota/NelcotaDeploy/internal/host"
	"github.com/Nelcota/NelcotaDeploy/internal/store/dbgen"
	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/embed"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Compilation of SQLite leaves a large one-time WASM compiler working set.
// Return those idle pages once, never in the query path.
var releaseCompilerMemory sync.Once

// LatestSchemaVersion is derived from the embedded migrations, including in
// release builds, so offline restore can reject a database from a newer binary.
func LatestSchemaVersion() int64 {
	entries, _ := fs.ReadDir(migrations, "migrations")
	var latest int64
	for _, entry := range entries {
		version, _ := strconv.ParseInt(strings.SplitN(entry.Name(), "_", 2)[0], 10, 64)
		latest = max(latest, version)
	}
	return latest
}

type Store struct {
	Write, Read *sql.DB
	Queries     *dbgen.Queries
	lock        *os.File
}

func Open(ctx context.Context, path string) (*Store, error) {
	abs, e := filepath.Abs(path)
	if e != nil {
		return nil, e
	}
	lock, e := host.LockFile(abs + ".lock")
	if e != nil {
		return nil, e
	}
	if _, e = os.Stat(filepath.Join(filepath.Dir(abs), "restore-in-progress")); e == nil {
		_ = lock.Close()
		return nil, fmt.Errorf("restore interrupted: repeat the restore before starting the panel")
	}
	dsn := (&url.URL{Scheme: "file", Path: abs}).String() + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)&_pragma=cache_size(-8192)&_pragma=mmap_size(67108864)"
	w, e := sql.Open("sqlite3", dsn)
	if e != nil {
		_ = lock.Close()
		return nil, e
	}
	w.SetMaxOpenConns(1)
	w.SetMaxIdleConns(1)
	fail := func(e error) (*Store, error) { _ = w.Close(); _ = lock.Close(); return nil, e }
	if _, e = w.ExecContext(ctx, "PRAGMA journal_mode=WAL"); e != nil {
		return fail(e)
	}
	p, e := goose.NewProvider(goose.DialectSQLite3, w, mustSub())
	if e != nil {
		return fail(e)
	}
	if _, e = p.Up(ctx); e != nil {
		return fail(fmt.Errorf("migrate: %w", e))
	}
	r, e := sql.Open("sqlite3", dsn+"&_pragma=query_only(1)")
	if e != nil {
		return fail(e)
	}
	r.SetMaxOpenConns(min(runtime.GOMAXPROCS(0), 4))
	r.SetMaxIdleConns(2)
	q, e := dbgen.Prepare(ctx, r)
	if e != nil {
		_ = r.Close()
		return fail(e)
	}
	releaseCompilerMemory.Do(debug.FreeOSMemory)
	return &Store{Write: w, Read: r, Queries: q, lock: lock}, nil
}
func (s *Store) Close() error {
	_ = s.Queries.Close()
	_ = s.Read.Close()
	e := s.Write.Close()
	_ = s.lock.Close()
	return e
}

func mustSub() fs.FS {
	f, e := fs.Sub(migrations, "migrations")
	if e != nil {
		panic(e)
	}
	return f
}
