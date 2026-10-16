package host

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestPrivateReadsRejectUnsafeFiles(t *testing.T) {
	dir := t.TempDir()
	private := filepath.Join(dir, "secret")
	if e := os.WriteFile(private, []byte("secret"), 0600); e != nil {
		t.Fatal(e)
	}
	link := filepath.Join(dir, "link")
	if e := os.Symlink(private, link); e != nil {
		t.Fatal(e)
	}
	if _, e := ReadSecret(link); e == nil {
		t.Fatal("followed a private-file symlink")
	}
	if e := os.Truncate(private, (1<<20)+1); e != nil {
		t.Fatal(e)
	}
	if _, e := ReadSecret(private); e == nil {
		t.Fatal("read an unbounded private file")
	}
}

func TestLockRejectsSpecialFilesLinksAndPublicPermissions(t *testing.T) {
	for _, kind := range []string{"fifo", "symlink", "hardlink", "public"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "panel.lock")
			other := filepath.Join(dir, "other")
			if e := os.WriteFile(other, []byte("untouched"), 0600); e != nil {
				t.Fatal(e)
			}
			var e error
			switch kind {
			case "fifo":
				e = syscall.Mkfifo(path, 0600)
			case "symlink":
				e = os.Symlink(other, path)
			case "hardlink":
				e = os.Link(other, path)
			case "public":
				e = os.WriteFile(path, nil, 0644)
				if e == nil {
					e = os.Chmod(path, 0644)
				}
			}
			if e != nil {
				t.Fatal(e)
			}
			if f, e := LockFile(path); e == nil {
				_ = f.Close()
				t.Fatal("accepted unsafe lock", kind)
			}
		})
	}
}

func TestLockExcludesAnotherProcessHandle(t *testing.T) {
	path := filepath.Join(t.TempDir(), "panel.lock")
	f, e := LockFile(path)
	if e != nil {
		t.Fatal(e)
	}
	if other, e := LockFile(path); e == nil {
		_ = other.Close()
		t.Fatal("acquired a held lock")
	}
	_ = f.Close()
	f, e = LockFile(path)
	if e != nil {
		t.Fatal(e)
	}
	_ = f.Close()
}
