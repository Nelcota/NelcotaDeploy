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
	"syscall"
	"testing"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/Nelcota/NelcotaDeploy/internal/store"
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
	restoredBackupKey, e := security.LoadKey(filepath.Join(target.Config, "backup.key"))
	sourceKey, _ := security.LoadKey(b.KeyFile)
	if e != nil || !bytes.Equal(restoredBackupKey, sourceKey) {
		t.Fatal("operator backup key was not preserved", e)
	}
	if e = (Backup{Data: target.Data, Config: target.Config, KeyFile: filepath.Join(target.Config, "backup.key")}).Create(ctx, filepath.Join(t.TempDir(), "after-restore.nbk")); e != nil {
		t.Fatal("backups did not work after restore", e)
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

func TestRestoreChecksMasterKeyAndInterruptedMarker(t *testing.T) {
	b, db, out := backupFixture(t)
	wrong := make([]byte, 32)
	_, _ = rand.Read(wrong)
	_ = os.WriteFile(filepath.Join(b.Config, "master.key"), wrong, 0600)
	if e := b.Create(t.Context(), out); e != nil {
		t.Fatal(e)
	}
	target := Backup{Data: filepath.Join(t.TempDir(), "data"), Config: filepath.Join(t.TempDir(), "config"), KeyFile: b.KeyFile}
	if e := target.Restore(t.Context(), out, false); e == nil {
		t.Fatal("restored wrong master key")
	}
	_ = db.Close()
	marker := filepath.Join(b.Data, "restore-in-progress")
	_ = os.WriteFile(marker, []byte("interrupted"), 0600)
	if opened, e := store.Open(t.Context(), filepath.Join(b.Data, "panel.db")); e == nil {
		_ = opened.Close()
		t.Fatal("started with interrupted restore")
	}
	protected := filepath.Join(t.TempDir(), "protected")
	_ = os.WriteFile(protected, []byte("keep"), 0600)
	_ = os.Remove(marker)
	_ = os.Symlink(protected, marker)
	if e := writeMarker(marker); e != nil {
		t.Fatal(e)
	}
	got, _ := os.ReadFile(protected)
	if string(got) != "keep" {
		t.Fatal("restore marker followed a symlink")
	}
}

func TestRestoreRejectsFutureSchemaAndUnreadableCertificateSecrets(t *testing.T) {
	for _, kind := range []string{"future_schema", "pending_certificate"} {
		t.Run(kind, func(t *testing.T) {
			b, db, out := backupFixture(t)
			if kind == "future_schema" {
				_, e := db.Write.ExecContext(t.Context(), "INSERT INTO goose_db_version(version_id,is_applied) VALUES(?,1)", store.LatestSchemaVersion()+1)
				if e != nil {
					t.Fatal(e)
				}
			} else {
				if _, e := db.Write.ExecContext(t.Context(), "INSERT INTO servers(id,name,wireguard_ip,pending_certificate) VALUES('peer','Peer','10.77.0.2',?)", []byte("invalid encrypted certificate")); e != nil {
					t.Fatal(e)
				}
			}
			if e := b.Create(t.Context(), out); e != nil {
				t.Fatal(e)
			}
			target := Backup{Data: filepath.Join(t.TempDir(), "data"), Config: filepath.Join(t.TempDir(), "config"), KeyFile: b.KeyFile}
			if e := target.Restore(t.Context(), out, false); e == nil {
				t.Fatal("installed incompatible backup", kind)
			}
			if _, e := os.Stat(filepath.Join(target.Data, "panel.db")); !os.IsNotExist(e) {
				t.Fatal("modified database before full validation")
			}
		})
	}
}

func TestRestoreInstallerIsConfinedAndDoesNotFollowSpecialSources(t *testing.T) {
	dir, outside := t.TempDir(), t.TempDir()
	root, e := os.OpenRoot(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	if e = os.Symlink(outside, filepath.Join(dir, "nested")); e != nil {
		t.Fatal(e)
	}
	source := filepath.Join(t.TempDir(), "source")
	_ = os.WriteFile(source, []byte("secret"), 0600)
	if e = installFile(t.Context(), root, "nested/key", source, true); e == nil {
		t.Fatal("restore escaped its configured root")
	}
	if entries, _ := os.ReadDir(outside); len(entries) != 0 {
		t.Fatal("wrote files outside the config directory")
	}
	_ = os.WriteFile(filepath.Join(dir, "existing"), []byte("keep"), 0600)
	if e = installFile(t.Context(), root, "existing", source, false); e == nil {
		t.Fatal("replaced an existing file without --replace")
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "existing")); string(b) != "keep" {
		t.Fatal("existing destination was modified")
	}
	_ = os.Remove(source)
	if e = syscall.Mkfifo(source, 0600); e != nil {
		t.Fatal(e)
	}
	if e = installFile(t.Context(), root, "key", source, true); e == nil {
		t.Fatal("installed a FIFO as a private key")
	}
}

func TestArchiveWriterEnforcesRestoreSizeLimit(t *testing.T) {
	var buf bytes.Buffer
	w, e := newSealer(&buf, make([]byte, 32))
	if e != nil {
		t.Fatal(e)
	}
	w.total = maxArchive - 1
	if _, e = w.Write([]byte("xx")); e == nil {
		t.Fatal("created a backup larger than restore accepts")
	}
}

func TestRestoreInheritsOwnerForNewDirectories(t *testing.T) {
	dir := t.TempDir()
	uid, gid := os.Getuid(), os.Getgid()
	if os.Geteuid() == 0 {
		uid, gid = 12345, 12346
		if e := os.Chown(dir, uid, gid); e != nil {
			t.Fatal(e)
		}
	}
	root, e := os.OpenRoot(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	source := filepath.Join(t.TempDir(), "source")
	if e = os.WriteFile(source, []byte("private"), 0600); e != nil {
		t.Fatal(e)
	}
	if e = installFile(t.Context(), root, "nested/child/key", source, true); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"nested", "nested/child", "nested/child/key"} {
		st, e := root.Stat(name)
		if e != nil {
			t.Fatal(e)
		}
		owner := st.Sys().(*syscall.Stat_t)
		if int(owner.Uid) != uid || int(owner.Gid) != gid {
			t.Fatalf("%s owner %d:%d, want %d:%d", name, owner.Uid, owner.Gid, uid, gid)
		}
	}
}

func TestVerifyTestRestoresWithoutTouchingData(t *testing.T) {
	b, _, _ := backupFixture(t)
	dir := filepath.Join(b.Data, "backups")
	if e := os.MkdirAll(dir, 0700); e != nil {
		t.Fatal(e)
	}
	// Nothing to verify yet.
	if e := b.VerifyLatest(t.Context()); e != nil {
		t.Fatal(e)
	}
	good := filepath.Join(dir, "nelcota-2026-10-15.nbk")
	if e := b.Create(t.Context(), good); e != nil {
		t.Fatal(e)
	}
	_ = os.WriteFile(good+".ok", []byte("x"), 0600)
	before, _ := os.ReadFile(filepath.Join(b.Data, "panel.db"))
	if e := b.VerifyLatest(t.Context()); e != nil {
		t.Fatal(e)
	}
	marker, e := os.ReadFile(filepath.Join(dir, "verified"))
	if e != nil || strings.TrimSpace(string(marker)) != "nelcota-2026-10-15.nbk" {
		t.Fatal(string(marker), e)
	}
	after, _ := os.ReadFile(filepath.Join(b.Data, "panel.db"))
	if !bytes.Equal(before, after) {
		t.Fatal("verification changed the live database")
	}
	if left, _ := filepath.Glob(filepath.Join(b.Data, ".verify-*")); len(left) != 0 {
		t.Fatal("staging directory left behind", left)
	}

	// A newer, damaged backup is reported once the week has passed.
	bad := filepath.Join(dir, "nelcota-2026-10-16.nbk")
	raw, _ := os.ReadFile(good)
	raw[len(raw)/2] ^= 0xff
	_ = os.WriteFile(bad, raw, 0600)
	_ = os.WriteFile(bad+".ok", []byte("x"), 0600)
	if e := b.VerifyLatest(t.Context()); e != nil {
		t.Fatal("verified again within a week", e)
	}
	old := time.Now().Add(-8 * 24 * time.Hour)
	_ = os.Chtimes(filepath.Join(dir, "verified"), old, old)
	if e := b.VerifyLatest(t.Context()); e == nil || !strings.Contains(e.Error(), "nelcota-2026-10-16.nbk") {
		t.Fatal("damaged backup passed verification", e)
	}
}

func writeMarker(path string) error {
	dir, e := os.OpenRoot(filepath.Dir(path))
	if e != nil {
		return e
	}
	defer dir.Close()
	return writeMarkerIn(dir, filepath.Base(path))
}
