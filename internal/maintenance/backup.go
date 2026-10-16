// Package maintenance contains bounded, offline-safe administrative operations.
package maintenance

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"errors"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/host"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/Nelcota/NelcotaDeploy/internal/store"
)

const magic = "NELCOTA-BACKUP\x01"
const chunkSize = 32 << 10
const maxArchive = int64(4 << 30)
const maxEntries = 4096

type Backup struct{ Data, Config, KeyFile string }

// Create uses a consistent SQLite snapshot even while the panel is writing WAL.
// The independent backup key is deliberately excluded from the archive.
func (b Backup) Create(ctx context.Context, output string) (err error) {
	key, err := security.LoadKey(b.KeyFile)
	if err != nil {
		return err
	}
	stage, err := os.MkdirTemp(b.Data, ".backup-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	snapshot := filepath.Join(stage, "panel.db")
	abs, err := filepath.Abs(filepath.Join(b.Data, "panel.db"))
	if err != nil {
		return err
	}
	db, err := sql.Open("sqlite3", (&url.URL{Scheme: "file", Path: abs}).String()+"?mode=rw&_pragma=busy_timeout(5000)")
	if err != nil {
		return err
	}
	defer db.Close()
	if _, err = db.ExecContext(ctx, "VACUUM INTO ?", snapshot); err != nil {
		return errors.New("database snapshot failed")
	}
	if err = os.Chmod(snapshot, 0600); err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(output), 0700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(output), ".backup-encrypted-")
	if err != nil {
		return err
	}
	defer func() { _ = tmp.Close(); _ = os.Remove(tmp.Name()) }()
	sw, err := newSealer(tmp, key)
	if err != nil {
		return err
	}
	tw := tar.NewWriter(sw)
	if err = addFile(ctx, tw, snapshot, "panel.db", 2<<30); err != nil {
		return err
	}
	entries := 1 // the SQLite snapshot
	configRoot, err := os.OpenRoot(b.Config)
	if err != nil {
		return err
	}
	defer configRoot.Close()
	err = fs.WalkDir(configRoot.FS(), ".", func(rel string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.IsDir() {
			return nil
		}
		// Backup credentials must live separately, even if configured under Config.
		same, _ := filepath.Abs(filepath.Join(b.Config, rel))
		keyAbs, _ := filepath.Abs(b.KeyFile)
		if same == keyAbs || rel == "backup.key" || strings.HasSuffix(rel, ".lock") || strings.HasSuffix(rel, ".before-restore") {
			return nil
		}
		entries++
		if entries > maxEntries {
			return errors.New("too many backup entries")
		}
		file, e := configRoot.OpenFile(rel, os.O_RDONLY|sysNoFollow, 0)
		if e != nil {
			return e
		}
		defer file.Close()
		return addOpenFile(ctx, tw, file, "config/"+filepath.ToSlash(rel), 32<<20)
	})
	if err != nil {
		return err
	}
	if err = tw.Close(); err != nil {
		return err
	}
	if err = sw.Close(); err != nil {
		return err
	}
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	// Link refuses accidental overwrite and makes the complete file visible at once.
	if err = os.Link(tmp.Name(), output); err != nil {
		return err
	}
	return syncDir(filepath.Dir(output))
}
func addFile(ctx context.Context, tw *tar.Writer, p, name string, max int64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	f, err := os.OpenFile(p, os.O_RDONLY|sysNoFollow, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	return addOpenFile(ctx, tw, f, name, max)
}
func addOpenFile(ctx context.Context, tw *tar.Writer, f *os.File, name string, max int64) error {
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() || st.Size() > max {
		return errors.New("invalid backup entry")
	}
	if err = tw.WriteHeader(&tar.Header{Name: name, Size: st.Size(), Mode: 0600, ModTime: st.ModTime()}); err != nil {
		return err
	}
	_, err = io.Copy(tw, &contextReader{ctx, f})
	return err
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r *contextReader) Read(p []byte) (int, error) {
	if e := r.ctx.Err(); e != nil {
		return 0, e
	}
	return r.r.Read(p)
}

// Each chunk is authenticated with its index, length and archive nonce. A final
// empty authenticated chunk rejects truncation (including at a chunk boundary).
type sealer struct {
	w      io.Writer
	a      cipher.AEAD
	prefix []byte
	index  uint32
	total  int64
}

func newSealer(w io.Writer, key []byte) (*sealer, error) {
	prefix := make([]byte, 32)
	if _, e := rand.Read(prefix); e != nil {
		return nil, e
	}
	a, e := archiveAEAD(key, prefix)
	if e != nil {
		return nil, e
	}
	if _, e = w.Write(append([]byte(magic), prefix...)); e != nil {
		return nil, e
	}
	return &sealer{w: w, a: a, prefix: prefix}, nil
}
func (s *sealer) frame(p []byte) error {
	if s.index == ^uint32(0) {
		return errors.New("backup too large")
	}
	nonce := make([]byte, 12)
	copy(nonce, s.prefix[:8])
	binary.BigEndian.PutUint32(nonce[8:], s.index)
	s.index++
	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(p)))
	sealed := s.a.Seal(nil, nonce, p, append([]byte(magic), size[:]...))
	if _, e := s.w.Write(size[:]); e != nil {
		return e
	}
	_, e := s.w.Write(sealed)
	return e
}
func (s *sealer) Write(p []byte) (int, error) {
	if int64(len(p)) > maxArchive-s.total {
		return 0, errors.New("backup too large")
	}
	n := 0
	for len(p) > 0 {
		size := min(len(p), chunkSize)
		if e := s.frame(p[:size]); e != nil {
			return n, e
		}
		n += size
		s.total += int64(size)
		p = p[size:]
	}
	return n, nil
}
func (s *sealer) Close() error { return s.frame(nil) }

type unsealer struct {
	r       io.Reader
	a       cipher.AEAD
	prefix  []byte
	index   uint32
	pending []byte
	done    bool
	total   int64
}

func newUnsealer(r io.Reader, key []byte) (*unsealer, error) {
	header := make([]byte, len(magic)+32)
	if _, e := io.ReadFull(r, header); e != nil {
		return nil, e
	}
	if string(header[:len(magic)]) != magic {
		return nil, errors.New("invalid backup format")
	}
	a, e := archiveAEAD(key, header[len(magic):])
	if e != nil {
		return nil, e
	}
	return &unsealer{r: r, a: a, prefix: header[len(magic):]}, nil
}
func (s *unsealer) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if len(s.pending) > 0 {
		n := copy(p, s.pending)
		s.pending = s.pending[n:]
		return n, nil
	}
	if s.done {
		return 0, io.EOF
	}
	var size [4]byte
	if _, e := io.ReadFull(s.r, size[:]); e != nil {
		return 0, errors.New("truncated backup")
	}
	n := binary.BigEndian.Uint32(size[:])
	if n > chunkSize || s.index == ^uint32(0) {
		return 0, errors.New("invalid backup chunk")
	}
	nonce := make([]byte, 12)
	copy(nonce, s.prefix[:8])
	binary.BigEndian.PutUint32(nonce[8:], s.index)
	s.index++
	sealed := make([]byte, int(n)+s.a.Overhead())
	if _, e := io.ReadFull(s.r, sealed); e != nil {
		return 0, errors.New("truncated backup")
	}
	plain, e := s.a.Open(nil, nonce, sealed, append([]byte(magic), size[:]...))
	if e != nil {
		return 0, errors.New("backup authentication failed")
	}
	s.total += int64(len(plain))
	if s.total > maxArchive {
		return 0, errors.New("backup too large")
	}
	if n == 0 {
		var b [1]byte
		if n, e := s.r.Read(b[:]); n != 0 || e != io.EOF {
			return 0, errors.New("trailing backup data")
		}
		s.done = true
		return 0, io.EOF
	}
	s.pending = plain
	return s.Read(p)
}
func syncDir(path string) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}

// Restore never starts services. A marker prevents startup after an interrupted
// replacement; re-running restore with the same authenticated archive completes it.
func (b Backup) Restore(ctx context.Context, input string, replace bool) error {
	if err := os.MkdirAll(b.Data, 0700); err != nil {
		return err
	}
	lock, err := host.LockFile(filepath.Join(b.Data, "panel.db.lock"))
	if err != nil {
		return err
	}
	defer lock.Close()
	key, err := security.LoadKey(b.KeyFile)
	if err != nil {
		return err
	}
	in, err := os.OpenFile(input, os.O_RDONLY|sysNoFollow, 0)
	if err != nil {
		return err
	}
	defer in.Close()
	st, err := in.Stat()
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() || st.Size() > maxArchive+(16<<20) {
		return errors.New("invalid backup file")
	}
	sr, err := newUnsealer(&contextReader{ctx, in}, key)
	if err != nil {
		return err
	}
	stage, err := os.MkdirTemp(b.Data, ".restore-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	tr := tar.NewReader(sr)
	seen := map[string]bool{}
	var total int64
	for {
		h, e := tr.Next()
		if e == io.EOF {
			break
		}
		if e != nil {
			return e
		}
		name := h.Name
		if h.Typeflag != tar.TypeReg || name == "config/backup.key" || name != filepath.ToSlash(filepath.Clean(name)) || strings.Contains(name, "\\") || (name != "panel.db" && !strings.HasPrefix(name, "config/")) || strings.HasPrefix(name, "/") || strings.Contains("/"+name+"/", "/../") || seen[name] {
			return errors.New("invalid archive path or entry")
		}
		if h.Size < 0 || h.Size > 2<<30 || (name != "panel.db" && h.Size > 32<<20) {
			return errors.New("archive entry too large")
		}
		total += h.Size
		if total > maxArchive {
			return errors.New("archive too large")
		}
		seen[name] = true
		if len(seen) > maxEntries {
			return errors.New("too many backup entries")
		}
		dest := filepath.Join(stage, filepath.FromSlash(name))
		if e = os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
			return e
		}
		out, e := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return e
		}
		_, e = io.Copy(out, &contextReader{ctx, tr})
		if e == nil {
			e = out.Sync()
		}
		_ = out.Close()
		if e != nil {
			return e
		}
	}
	// tar EOF is not the encrypted stream EOF: authenticate the final frame too.
	if n, e := io.Copy(io.Discard, sr); e != nil || n != 0 {
		return errors.New("invalid archive footer")
	}
	if !seen["panel.db"] || !seen["config/master.key"] {
		return errors.New("incomplete backup")
	}
	if _, err = security.LoadKey(filepath.Join(stage, "config/master.key")); err != nil {
		return err
	}
	if err = checkDatabase(ctx, filepath.Join(stage, "panel.db")); err != nil {
		return err
	}
	if err = validateSecrets(ctx, stage); err != nil {
		return err
	}
	// Recreate the backup key from the operator-supplied copy, never from tar.
	if err = os.WriteFile(filepath.Join(stage, "config/backup.key"), key, 0600); err != nil {
		return err
	}
	seen["config/backup.key"] = true
	targets := map[string]string{"panel.db": filepath.Join(b.Data, "panel.db")}
	for name := range seen {
		if strings.HasPrefix(name, "config/") {
			targets[name] = filepath.Join(b.Config, filepath.FromSlash(strings.TrimPrefix(name, "config/")))
		}
	}
	if !replace {
		for name, dest := range targets {
			if name == "config/backup.key" {
				if existing, e := security.LoadKey(dest); e == nil && bytes.Equal(existing, key) {
					delete(targets, name)
					continue
				}
			}
			if _, e := os.Lstat(dest); !errors.Is(e, os.ErrNotExist) {
				return errors.New("restore destination exists; use --replace with stopped panel")
			}
		}
	}
	if err = safeParents(b.Config); err != nil {
		return err
	}
	dataRoot, err := os.OpenRoot(b.Data)
	if err != nil {
		return err
	}
	defer dataRoot.Close()
	configRoot, err := os.OpenRoot(b.Config)
	if err != nil {
		return err
	}
	defer configRoot.Close()
	if err = writeMarkerIn(dataRoot, "restore-in-progress"); err != nil {
		return err
	}
	if err = syncRoot(dataRoot); err != nil {
		return err
	}
	// Pin each destination directory. os.Root confines every operation even if
	// another process replaces an ancestor after path validation.
	for name := range targets {
		root, relative := dataRoot, name
		if strings.HasPrefix(name, "config/") {
			root, relative = configRoot, strings.TrimPrefix(name, "config/")
		}
		if err = installFile(ctx, root, relative, filepath.Join(stage, filepath.FromSlash(name)), replace); err != nil {
			return err
		}
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		if e := dataRoot.Remove("panel.db" + suffix); e != nil && !errors.Is(e, os.ErrNotExist) {
			return e
		}
	}
	if err = dataRoot.Remove("restore-in-progress"); err != nil {
		return err
	}
	return syncRoot(dataRoot)
}

func installFile(ctx context.Context, root *os.Root, relative, source string, replace bool) error {
	dir, e := restoreParent(root, filepath.Dir(relative))
	if e != nil {
		return e
	}
	defer dir.Close()
	base := filepath.Base(relative)
	if st, e := dir.Lstat(base); e == nil {
		if !st.Mode().IsRegular() {
			return errors.New("restore target is not regular")
		}
		if e = dir.Link(base, base+".before-restore"); e != nil && !errors.Is(e, os.ErrExist) {
			return e
		}
	} else if !errors.Is(e, os.ErrNotExist) {
		return e
	}
	name := ".restore-" + rand.Text()
	tmp, e := dir.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	defer func() { _ = tmp.Close(); _ = dir.Remove(name) }()
	src, e := os.OpenFile(source, os.O_RDONLY|sysNoFollow, 0)
	if e != nil {
		return e
	}
	defer src.Close()
	st, e := src.Stat()
	if e != nil {
		return e
	}
	if !st.Mode().IsRegular() {
		return errors.New("restore source is not regular")
	}
	if _, e = io.Copy(tmp, &contextReader{ctx, src}); e != nil {
		return e
	}
	if e = host.InheritOwner(tmp, dir); e != nil {
		return e
	}
	if e = tmp.Sync(); e != nil {
		return e
	}
	if e = tmp.Close(); e != nil {
		return e
	}
	if replace {
		e = dir.Rename(name, base)
	} else {
		// Link provides no-replace semantics even if a destination appears after
		// the initial --replace check.
		e = dir.Link(name, base)
	}
	if e != nil {
		return e
	}
	return syncRoot(dir)
}

// Newly created directories inherit the existing parent's service account, so a
// root-run restore does not leave a private subtree unreadable by the daemon.
func restoreParent(root *os.Root, relative string) (*os.Root, error) {
	dir, e := root.OpenRoot(".")
	if e != nil {
		return nil, e
	}
	for _, part := range strings.Split(relative, string(filepath.Separator)) {
		if part == "." {
			continue
		}
		e := dir.Mkdir(part, 0700)
		if e != nil && !errors.Is(e, os.ErrExist) {
			_ = dir.Close()
			return nil, e
		}
		if e == nil {
			file, err := dir.OpenFile(part, os.O_RDONLY|sysNoFollow|sysDirectory, 0)
			if err == nil {
				err = host.InheritOwner(file, dir)
				_ = file.Close()
			}
			if err != nil {
				_ = dir.Close()
				return nil, err
			}
		}
		next, err := dir.OpenRoot(part)
		if err == nil {
			err = syncRoot(dir)
		}
		_ = dir.Close()
		if err != nil {
			if next != nil {
				_ = next.Close()
			}
			return nil, err
		}
		dir = next
	}
	return dir, nil
}

func syncRoot(root *os.Root) error {
	dir, e := root.Open(".")
	if e != nil {
		return e
	}
	defer dir.Close()
	return dir.Sync()
}
func safeParents(path string) error {
	abs, e := filepath.Abs(path)
	if e != nil {
		return e
	}
	cur := string(filepath.Separator)
	for _, part := range strings.Split(strings.TrimPrefix(abs, cur), string(filepath.Separator)) {
		cur = filepath.Join(cur, part)
		st, e := os.Lstat(cur)
		if errors.Is(e, os.ErrNotExist) {
			e = os.Mkdir(cur, 0700)
			if e != nil {
				return e
			}
		} else if e != nil {
			return e
		} else if !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
			return errors.New("unsafe restore directory")
		}
	}
	return nil
}
func checkDatabase(ctx context.Context, path string) error {
	db, e := sql.Open("sqlite3", (&url.URL{Scheme: "file", Path: path}).String()+"?mode=ro")
	if e != nil {
		return e
	}
	defer db.Close()
	var result string
	if e = db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&result); e != nil || result != "ok" {
		return errors.New("backup database integrity failed")
	}
	var version int64
	if e = db.QueryRowContext(ctx, "SELECT max(version_id) FROM goose_db_version WHERE is_applied=1").Scan(&version); e != nil || version < 1 || version > store.LatestSchemaVersion() {
		return errors.New("invalid backup schema")
	}
	rows, e := db.QueryContext(ctx, "PRAGMA foreign_key_check")
	if e != nil {
		return e
	}
	defer rows.Close()
	if rows.Next() {
		return errors.New("backup database has broken references")
	}
	if e = rows.Err(); e != nil {
		return e
	}
	return nil
}

// RunBackups retries a failed upload on the next tick without losing the local
// archive. A success marker is written only after the optional remote upload.
func (b Backup) Run(ctx context.Context, upload func(context.Context, string) error, report func(error)) error {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		if e := b.daily(ctx, upload); e != nil && ctx.Err() == nil {
			report(e)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
	}
}
func (b Backup) daily(ctx context.Context, upload func(context.Context, string) error) error {
	dir := filepath.Join(b.Data, "backups")
	if e := os.MkdirAll(dir, 0700); e != nil {
		return e
	}
	name := "nelcota-" + time.Now().UTC().Format("2006-01-02") + ".nbk"
	p := filepath.Join(dir, name)
	if _, e := os.Stat(p + ".ok"); e == nil {
		return nil
	}
	run, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	if _, e := os.Stat(p); errors.Is(e, os.ErrNotExist) {
		if e = b.Create(run, p); e != nil {
			return e
		}
	}
	if upload != nil {
		if e := upload(run, p); e != nil {
			return e
		}
	}
	if e := os.WriteFile(p+".ok", []byte(time.Now().UTC().Format(time.RFC3339)), 0600); e != nil {
		return e
	}
	entries, e := os.ReadDir(dir)
	if e != nil {
		return e
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -6).Format("2006-01-02")
	for _, entry := range entries {
		n := entry.Name()
		if len(n) == len(name) && strings.HasPrefix(n, "nelcota-") && strings.HasSuffix(n, ".nbk") && n[8:18] < cutoff {
			_ = os.Remove(filepath.Join(dir, n))
			_ = os.Remove(filepath.Join(dir, n+".ok"))
		}
	}
	return nil
}

func archiveAEAD(key, salt []byte) (cipher.AEAD, error) {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(magic))
	h.Write(salt)
	c, e := aes.NewCipher(h.Sum(nil))
	if e != nil {
		return nil, e
	}
	return cipher.NewGCM(c)
}

func writeMarker(path string) error {
	dir, e := os.OpenRoot(filepath.Dir(path))
	if e != nil {
		return e
	}
	defer dir.Close()
	return writeMarkerIn(dir, filepath.Base(path))
}
func writeMarkerIn(dir *os.Root, base string) error {
	name := ".restore-marker-" + rand.Text()
	f, e := dir.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	defer func() { _ = f.Close(); _ = dir.Remove(name) }()
	if _, e = f.WriteString("Repeat restore before starting the panel.\n"); e != nil {
		return e
	}
	if e = f.Sync(); e != nil {
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	return dir.Rename(name, base)
}
