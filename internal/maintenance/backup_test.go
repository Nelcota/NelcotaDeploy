package maintenance

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/rand"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nelcota/nelcota-deploy/internal/security"
	"github.com/nelcota/nelcota-deploy/internal/store"
)

func backupFixture(t *testing.T) (Backup, *store.Store, string) {
	t.Helper()
	root := t.TempDir()
	b := Backup{Data: filepath.Join(root, "data"), Config: filepath.Join(root, "config"), KeyFile: filepath.Join(root, "backup.key")}
	for _, p := range []string{b.Data, b.Config} {
		if e := os.MkdirAll(p, 0700); e != nil {
			t.Fatal(e)
		}
	}
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	if e := os.WriteFile(b.KeyFile, key, 0600); e != nil {
		t.Fatal(e)
	}
	_, _ = rand.Read(key)
	if e := os.WriteFile(filepath.Join(b.Config, "master.key"), key, 0600); e != nil {
		t.Fatal(e)
	}
	db, e := store.Open(t.Context(), filepath.Join(b.Data, "panel.db"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = db.Close() })
	v, _ := security.NewVault(key)
	ciphertext, e := v.Seal([]byte("private-environment-value"), "setting:test")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Write.ExecContext(t.Context(), "INSERT INTO settings(key,encrypted) VALUES('test',?)", ciphertext); e != nil {
		t.Fatal(e)
	}
	return b, db, filepath.Join(root, "snapshot.nbk")
}
func TestOnlineBackupRestoreAndOfflineLock(t *testing.T) {
	b, db, out := backupFixture(t)
	ctx := t.Context()
	if e := b.Create(ctx, out); e != nil {
		t.Fatal(e)
	}
	raw, _ := os.ReadFile(out)
	if bytes.Contains(raw, []byte("private-environment-value")) || bytes.Contains(raw, []byte("SQLite format")) {
		t.Fatal("unencrypted archive")
	}
	if e := b.Create(ctx, out); e == nil {
		t.Fatal("overwrote backup")
	}
	if e := b.Restore(ctx, out, true); e == nil {
		t.Fatal("restored while database open")
	}
	target := Backup{Data: filepath.Join(t.TempDir(), "data"), Config: filepath.Join(t.TempDir(), "keys"), KeyFile: b.KeyFile}
	if e := target.Restore(ctx, out, false); e != nil {
		t.Fatal(e)
	}
	restored, e := store.Open(ctx, filepath.Join(target.Data, "panel.db"))
	if e != nil {
		t.Fatal(e)
	}
	var encrypted []byte
	if e = restored.Read.QueryRowContext(ctx, "SELECT encrypted FROM settings WHERE key='test'").Scan(&encrypted); e != nil {
		t.Fatal(e)
	}
	key, _ := security.LoadKey(filepath.Join(target.Config, "master.key"))
	v, _ := security.NewVault(key)
	plain, e := v.Open(encrypted, "setting:test")
	if e != nil || string(plain) != "private-environment-value" {
		t.Fatal("restored secret mismatch", e)
	}
	_ = restored.Close()
	if _, e = os.Stat(filepath.Join(target.Config, "backup.key")); !os.IsNotExist(e) {
		t.Fatal("backup key archived")
	}
	if e = target.Restore(ctx, out, false); e == nil {
		t.Fatal("replaced without flag")
	}
	if e = target.Restore(ctx, out, true); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(filepath.Join(target.Data, "panel.db.before-restore")); e != nil {
		t.Fatal(e)
	}
	_ = db.Close()
}
func TestArchiveAuthenticationTruncationAndTraversal(t *testing.T) {
	b, _, out := backupFixture(t)
	if e := b.Create(t.Context(), out); e != nil {
		t.Fatal(e)
	}
	raw, _ := os.ReadFile(out)
	for _, mutate := range []func([]byte) []byte{
		func(v []byte) []byte { v[len(v)/2] ^= 1; return v },
		func(v []byte) []byte { return v[:len(v)-20] },
		func(v []byte) []byte { return append(v, 0) },
		func(v []byte) []byte { v[10] ^= 1; return v },
	} {
		target := Backup{Data: filepath.Join(t.TempDir(), "data"), Config: filepath.Join(t.TempDir(), "keys"), KeyFile: b.KeyFile}
		bad := filepath.Join(t.TempDir(), "bad.nbk")
		_ = os.WriteFile(bad, mutate(bytes.Clone(raw)), 0600)
		if e := target.Restore(t.Context(), bad, false); e == nil {
			t.Fatal("accepted corrupt archive")
		}
		if _, e := os.Stat(filepath.Join(target.Data, "panel.db")); !os.IsNotExist(e) {
			t.Fatal("modified destination before validation")
		}
	}
	key, _ := security.LoadKey(b.KeyFile)
	for _, name := range []string{"config/../../escaped", "/absolute", "config/../master.key", "config/a\\b"} {
		var buf bytes.Buffer
		sw, _ := newSealer(&buf, key)
		tw := tar.NewWriter(sw)
		_ = tw.WriteHeader(&tar.Header{Name: name, Mode: 0600, Size: 1})
		_, _ = tw.Write([]byte("x"))
		_ = tw.Close()
		_ = sw.Close()
		bad := filepath.Join(t.TempDir(), "bad.nbk")
		_ = os.WriteFile(bad, buf.Bytes(), 0600)
		target := Backup{Data: filepath.Join(t.TempDir(), "data"), Config: filepath.Join(t.TempDir(), "keys"), KeyFile: b.KeyFile}
		if e := target.Restore(t.Context(), bad, true); e == nil {
			t.Fatal("accepted traversal", name)
		}
	}
}
func TestBackupCancellationSymlinksAndDailyRetry(t *testing.T) {
	b, _, out := backupFixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if e := b.Create(ctx, out); e == nil {
		t.Fatal("ignored cancellation")
	}
	if e := os.Symlink(b.KeyFile, filepath.Join(b.Config, "link")); e != nil {
		t.Fatal(e)
	}
	if e := b.Create(t.Context(), out); e == nil {
		t.Fatal("followed symlink")
	}
	_ = os.Remove(filepath.Join(b.Config, "link"))
	calls := 0
	upload := func(context.Context, string) error {
		calls++
		if calls == 1 {
			return io.ErrUnexpectedEOF
		}
		return nil
	}
	if e := b.daily(t.Context(), upload); e == nil {
		t.Fatal("upload failure hidden")
	}
	if e := b.daily(t.Context(), upload); e != nil {
		t.Fatal(e)
	}
	if e := b.daily(t.Context(), upload); e != nil {
		t.Fatal(e)
	}
	if calls != 2 {
		t.Fatal(calls)
	}
	old := filepath.Join(b.Data, "backups", "nelcota-"+time.Now().UTC().AddDate(0, 0, -9).Format("2006-01-02")+".nbk")
	_ = os.WriteFile(old, []byte("old"), 0600)
	// Force today's retry to exercise retention.
	entries, _ := os.ReadDir(filepath.Join(b.Data, "backups"))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".ok") {
			_ = os.Remove(filepath.Join(b.Data, "backups", e.Name()))
		}
	}
	if e := b.daily(t.Context(), nil); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(old); !os.IsNotExist(e) {
		t.Fatal("retention did not remove old backup")
	}
}
func TestStreamHasBoundedFramesAndRejectsReorder(t *testing.T) {
	key := make([]byte, 32)
	var buf bytes.Buffer
	sw, _ := newSealer(&buf, key)
	input := bytes.Repeat([]byte("0123456789"), 100000)
	_, _ = sw.Write(input)
	_ = sw.Close()
	sr, _ := newUnsealer(bytes.NewReader(buf.Bytes()), key)
	got, e := io.ReadAll(sr)
	if e != nil || !bytes.Equal(got, input) {
		t.Fatal(e)
	}
	data := bytes.Clone(buf.Bytes())
	start := len(magic) + 32
	frame := 4 + chunkSize + 16
	copy(data[start:start+frame], data[start+frame:start+2*frame])
	sr, _ = newUnsealer(bytes.NewReader(data), key)
	if _, e = io.ReadAll(sr); e == nil {
		t.Fatal("accepted reordered frame")
	}
}
