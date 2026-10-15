package host

import (
	"os"
	"path/filepath"
	"runtime/trace"
	"testing"
	"time"
)

func TestSlowTraceThresholdRateAndPermissions(t *testing.T) {
	recorder := trace.NewFlightRecorder(trace.FlightRecorderConfig{MaxBytes: 1 << 20, MinAge: time.Millisecond})
	if e := recorder.Start(); e != nil {
		t.Fatal(e)
	}
	defer recorder.Stop()
	f := &flight{recorder: recorder}
	currentFlight.Store(f)
	defer currentFlight.Store(nil)
	dir := t.TempDir()
	if CaptureSlow(dir, "../id", time.Second, 2*time.Second) {
		t.Fatal("captured fast deploy")
	}
	time.Sleep(5 * time.Millisecond)
	if !CaptureSlow(dir, "../id", 3*time.Second, 2*time.Second) {
		t.Fatal("did not capture slow deploy")
	}
	if CaptureSlow(dir, "id", 3*time.Second, 2*time.Second) {
		t.Fatal("trace rate limit")
	}
	entries, e := os.ReadDir(dir)
	if e != nil || len(entries) != 1 {
		t.Fatal(entries, e)
	}
	st, e := os.Stat(filepath.Join(dir, entries[0].Name()))
	if e != nil || st.Mode().Perm() != 0600 || st.Size() == 0 {
		t.Fatal(st, e)
	}
}
