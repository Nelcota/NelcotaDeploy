package host

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

// Lock excludes a running panel and offline maintenance. The lock file stays in
// place: unlinking it would allow two processes to lock different inodes.
func LockFile(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, errors.New("panel data is in use; stop the panel before offline maintenance")
	}
	if err = InheritOwner(f, filepath.Dir(path)); err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}

func InheritOwner(file *os.File, parent string) error {
	if os.Geteuid() != 0 {
		return nil
	}
	st, e := os.Stat(parent)
	if e != nil {
		return e
	}
	owner, ok := st.Sys().(*syscall.Stat_t)
	if !ok {
		return nil
	}
	return file.Chown(int(owner.Uid), int(owner.Gid))
}
