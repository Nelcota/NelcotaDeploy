package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"net/url"
	"path/filepath"
	"runtime"

	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/embed"
	"github.com/nelcota/nelcota-deploy/internal/store/dbgen"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct {
	Write, Read *sql.DB
	Queries     *dbgen.Queries
}

func Open(ctx context.Context, path string) (*Store, error) {
	abs, e := filepath.Abs(path)
	if e != nil {
		return nil, e
	}
	dsn := (&url.URL{Scheme: "file", Path: abs}).String() + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)&_pragma=cache_size(-8192)&_pragma=mmap_size(67108864)"
	w, e := sql.Open("sqlite3", dsn)
	if e != nil {
		return nil, e
	}
	w.SetMaxOpenConns(1)
	w.SetMaxIdleConns(1)
	fail := func(e error) (*Store, error) { _ = w.Close(); return nil, e }
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
	return &Store{w, r, q}, nil
}
func (s *Store) Close() error { _ = s.Queries.Close(); _ = s.Read.Close(); return s.Write.Close() }

func mustSub() fs.FS {
	f, e := fs.Sub(migrations, "migrations")
	if e != nil {
		panic(e)
	}
	return f
}
