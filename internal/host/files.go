package host

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

func ReadSecret(path string) ([]byte, error) { return ReadPrivate(path, 1<<20) }

// Validate the opened descriptor, not a path that could change before the read.
// NONBLOCK prevents a substituted FIFO from stalling startup or root maintenance.
func ReadPrivate(path string, max int64) ([]byte, error) {
	f, e := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return nil, e
	}
	if max < 0 || !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 || st.Size() > max {
		return nil, errors.New("private file must be regular, bounded and have mode 0600")
	}
	b, e := io.ReadAll(io.LimitReader(f, max+1))
	if e != nil {
		return nil, e
	}
	if int64(len(b)) > max {
		return nil, errors.New("private file too large")
	}
	return b, nil
}

// WriteFileAtomic replaces path with data so readers see the old or the new
// file, never a partial one, also across a crash.
func WriteFileAtomic(path string, data []byte, perm os.FileMode) error {
	return WriteAtomic(path, perm, func(w io.Writer) error {
		_, e := w.Write(data)
		return e
	})
}

// WriteAtomic is WriteFileAtomic for content that is streamed rather than held in memory.
func WriteAtomic(path string, perm os.FileMode, write func(io.Writer) error) error {
	dir := filepath.Dir(path)
	if e := os.MkdirAll(dir, 0700); e != nil {
		return e
	}
	f, e := os.CreateTemp(dir, ".write-")
	if e != nil {
		return e
	}
	defer func() { _ = f.Close(); _ = os.Remove(f.Name()) }()
	if e = f.Chmod(perm); e != nil {
		return e
	}
	if e = write(f); e != nil {
		return e
	}
	if e = f.Sync(); e != nil {
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = os.Rename(f.Name(), path); e != nil {
		return e
	}
	return SyncDir(dir)
}

// SyncDir makes completed renames and links in a directory durable.
func SyncDir(path string) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}

// SyncRoot is SyncDir for a directory opened as an os.Root.
func SyncRoot(root *os.Root) error {
	f, e := root.Open(".")
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}
