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
	parent, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	f, err := parent.OpenFile(filepath.Base(path), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0600)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, err
	}
	inode, ok := st.Sys().(*syscall.Stat_t)
	if !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 || !ok || inode.Nlink != 1 {
		_ = f.Close()
		return nil, errors.New("lock must be a private regular file with one link")
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, errors.New("panel data is in use; stop the panel before offline maintenance")
	}
	if err = InheritOwner(f, parent); err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}

func InheritOwner(file *os.File, parent *os.Root) error {
	if os.Geteuid() != 0 {
		return nil
	}
	st, e := parent.Stat(".")
	if e != nil {
		return e
	}
	return inheritOwner(file, st)
}
func inheritOwner(file *os.File, st os.FileInfo) error {
	if os.Geteuid() != 0 {
		return nil
	}
	owner, ok := st.Sys().(*syscall.Stat_t)
	if !ok {
		return nil
	}
	return file.Chown(int(owner.Uid), int(owner.Gid))
}
