package store

import (
	"errors"
	"os"
	"syscall"
)

// Lock excludes a running panel and offline maintenance. The lock file stays in
// place: unlinking it would allow two processes to lock different inodes.
func Lock(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, errors.New("panel data is in use; stop the panel before offline maintenance")
	}
	return f, nil
}
