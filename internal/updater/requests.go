package updater

import (
	"context"
	"os"
	"path/filepath"
	"time"
)

func administrativePath(data string) string { return filepath.Join(data, "admin-update.json") }

// RequestUpgrade goes through the daemon's idle/rollout checks. It cannot
// trigger the privileged helper directly, so CLI updates also wait for builds.
func RequestUpgrade(data string, r Request) error {
	return queueFile(administrativePath(data), data, r)
}
func RunRequests(ctx context.Context, data string, consume func(context.Context, Request) (bool, error), report func(error)) error {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
			r, e := readDataRequest(data, "admin-update.json")
			if os.IsNotExist(e) {
				continue
			}
			if e != nil {
				report(e)
				removeRequest(data, "admin-update.json")
				continue
			}
			done, e := consume(ctx, r)
			if e != nil {
				result := Result{ID: r.ID, Version: r.Version, Status: "failed", At: time.Now().Unix()}
				_ = writeResult(data, result)
				report(e)
				done = true
			}
			if done {
				removeRequest(data, "admin-update.json")
			}
		}
	}
}
func ValidRequest(r Request) bool { return ValidVersion(r.Version) && requestIDRE.MatchString(r.ID) }
