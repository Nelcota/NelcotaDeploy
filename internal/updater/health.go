package updater

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/Nelcota/NelcotaDeploy/internal/host"
)

type Health struct {
	PID     int    `json:"pid"`
	Version string `json:"version"`
	Ready   bool   `json:"ready"`
	At      int64  `json:"at"`
}

func WriteHealth(data, version string, ready bool) error {
	b, _ := json.Marshal(Health{PID: os.Getpid(), Version: version, Ready: ready, At: time.Now().Unix()})
	return host.WriteFileAtomic(filepath.Join(data, "agent-health.json"), b, 0600)
}
func healthyAgent(data, version string, pid int) bool {
	root, e := os.OpenRoot(data)
	if e != nil {
		return false
	}
	defer root.Close()
	f, e := root.OpenFile("agent-health.json", os.O_RDONLY|sysNoFollow, 0)
	if e != nil {
		return false
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, 4097))
	if e != nil || len(b) > 4096 {
		return false
	}
	var h Health
	if json.Unmarshal(b, &h) != nil {
		return false
	}
	return h.PID == pid && h.Version == version && h.Ready && time.Now().Unix()-h.At >= 0 && time.Now().Unix()-h.At <= 10
}
func PendingFor(data, version string) bool {
	r, e := readDataRequest(data, "update/request.json")
	if os.IsNotExist(e) {
		return false
	}
	return e != nil || r.Version != version
}
