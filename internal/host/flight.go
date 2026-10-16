package host

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"runtime/trace"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type flight struct {
	recorder *trace.FlightRecorder
	mu       sync.Mutex
	last     time.Time
}

var currentFlight atomic.Pointer[flight]

// CaptureSlow saves at most one private trace per hour, retaining five. Disabled
// diagnostics have zero background recorder cost. It never waits on another dump.
func CaptureSlow(dir, id string, elapsed, threshold time.Duration) bool {
	f := currentFlight.Load()
	if f == nil || elapsed < threshold || threshold <= 0 || !f.mu.TryLock() {
		return false
	}
	defer f.mu.Unlock()
	if time.Since(f.last) < time.Hour {
		return false
	}
	return f.capture(dir, id)
}
func (f *flight) capture(dir, id string) bool {
	digest := sha256.Sum256([]byte(id))
	name := time.Now().UTC().Format("20060102T150405.000000000") + "-" + hex.EncodeToString(digest[:8]) + ".trace"
	e := WriteAtomic(filepath.Join(dir, name), 0600, func(w io.Writer) error {
		_, e := f.recorder.WriteTo(w)
		return e
	})
	if e != nil {
		return false
	}
	f.last = time.Now()
	entries, e := os.ReadDir(dir)
	if e != nil {
		return true
	}
	names := []string{}
	for _, entry := range entries {
		if entry.Type().IsRegular() && strings.HasSuffix(entry.Name(), ".trace") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	if len(names) > 5 {
		for _, name := range names[:len(names)-5] {
			_ = os.Remove(filepath.Join(dir, name))
		}
	}
	return true
}
