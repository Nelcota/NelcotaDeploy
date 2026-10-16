package updater

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"

	"github.com/Nelcota/NelcotaDeploy/internal/host"
)

func queueFile(p, data string, r Request) error {
	if !ValidRequest(r) {
		return errors.New("invalid update request")
	}
	rel, e := filepath.Rel(data, p)
	if e != nil {
		return e
	}
	root, e := os.OpenRoot(data)
	if e != nil {
		return e
	}
	defer root.Close()
	if e = root.MkdirAll(filepath.Dir(rel), 0700); e != nil {
		return e
	}
	dir, e := root.OpenRoot(filepath.Dir(rel))
	if e != nil {
		return e
	}
	defer dir.Close()
	name := ".request-" + rand.Text()
	f, e := dir.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	defer func() { _ = f.Close(); _ = dir.Remove(name) }()
	b, _ := json.Marshal(r)
	if _, e = f.Write(b); e != nil {
		return e
	}
	if os.Geteuid() == 0 {
		if st, e := root.Stat("."); e == nil {
			if owner, ok := st.Sys().(*syscall.Stat_t); ok {
				if e = f.Chown(int(owner.Uid), int(owner.Gid)); e != nil {
					return e
				}
			}
		}
	}
	if e = f.Sync(); e != nil {
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = dir.Link(name, filepath.Base(rel)); e != nil {
		return errors.New("an update is already requested")
	}
	return host.SyncRoot(dir)
}
func readDataRequest(data, relative string) (Request, error) {
	root, e := os.OpenRoot(data)
	if e != nil {
		return Request{}, e
	}
	defer root.Close()
	f, e := root.OpenFile(relative, os.O_RDONLY|sysNoFollow, 0)
	if e != nil {
		return Request{}, e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 || st.Size() > 4096 {
		return Request{}, errors.New("invalid update request file")
	}
	b, e := io.ReadAll(io.LimitReader(f, 4097))
	if e != nil {
		return Request{}, e
	}
	var r Request
	if e = json.Unmarshal(b, &r); e != nil || !ValidRequest(r) {
		return Request{}, errors.New("invalid update request")
	}
	return r, nil
}
func writeResult(data string, result Result) error {
	root, e := os.OpenRoot(data)
	if e != nil {
		return e
	}
	defer root.Close()
	if e = root.MkdirAll("update", 0700); e != nil {
		return e
	}
	dir, e := root.OpenRoot("update")
	if e != nil {
		return e
	}
	defer dir.Close()
	name := ".result-" + rand.Text()
	f, e := dir.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if e != nil {
		return e
	}
	defer func() { _ = f.Close(); _ = dir.Remove(name) }()
	b, _ := json.Marshal(result)
	if _, e = f.Write(b); e != nil {
		return e
	}
	if e = f.Chmod(0644); e != nil {
		return e
	}
	if e = f.Sync(); e != nil {
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = dir.Rename(name, "result.json"); e != nil {
		return e
	}
	return host.SyncRoot(dir)
}
func removeRequest(data, relative string) {
	root, e := os.OpenRoot(data)
	if e != nil {
		return
	}
	defer root.Close()
	_ = root.Remove(relative)
}
