package host

import (
	"errors"
	"io"
	"os"
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
