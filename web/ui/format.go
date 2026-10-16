package ui

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Now is replaceable in tests.
var Now = time.Now

// Tone maps a deployment, server, or operation status to a color tone.
func Tone(status string) string {
	switch status {
	case "success", "online", "running", "applied", "ready", "live":
		return "success"
	case "failed", "offline", "error", "not_live", "update_failed":
		return "danger"
	case "building", "starting", "waiting", "deploying", "publishing":
		return "info"
	case "queued", "pending", "not_ready":
		return "warning"
	default:
		return "muted"
	}
}

// StatusLabel returns the human label for a status value.
func StatusLabel(status string) string {
	switch status {
	case "":
		return "Not published"
	case "queued":
		return "Waiting"
	case "success":
		return "Published"
	case "not_ready":
		return "Recovering"
	case "waiting":
		return "Running"
	case "applied":
		return "Complete"
	default:
		return strings.ToUpper(status[:1]) + strings.ReplaceAll(status[1:], "_", " ")
	}
}

// Active reports whether a deployment is still in progress.
func Active(status string) bool {
	return status == "queued" || status == "building" || status == "starting"
}

// ShortSHA abbreviates a commit SHA.
func ShortSHA(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}

// Ago formats a Unix timestamp relative to now.
func Ago(unix int64) string {
	if unix <= 0 {
		return "never"
	}
	d := Now().Sub(time.Unix(unix, 0))
	switch {
	case d < 0:
		return "just now"
	case d < 45*time.Second:
		return "just now"
	case d < time.Hour:
		return strconv.Itoa(int(d.Round(time.Minute)/time.Minute)) + " min ago"
	case d < 48*time.Hour:
		return strconv.Itoa(int(d/time.Hour)) + " h ago"
	default:
		return strconv.Itoa(int(d/(24*time.Hour))) + " days ago"
	}
}

// Timestamp formats a Unix timestamp as an absolute UTC time for titles and <time>.
func Timestamp(unix int64) string {
	if unix <= 0 {
		return ""
	}
	return time.Unix(unix, 0).UTC().Format("2006-01-02 15:04:05 UTC")
}

// ISO formats a Unix timestamp for the datetime attribute.
func ISO(unix int64) string {
	if unix <= 0 {
		return ""
	}
	return time.Unix(unix, 0).UTC().Format(time.RFC3339)
}

// Millis formats a stage duration in milliseconds.
func Millis(ms int64) string {
	switch {
	case ms < 0:
		return "—"
	case ms < 1000:
		return strconv.FormatInt(ms, 10) + " ms"
	case ms < 60_000:
		return strconv.FormatFloat(float64(ms)/1000, 'f', 1, 64) + " s"
	default:
		return fmt.Sprintf("%dm %02ds", ms/60_000, ms%60_000/1000)
	}
}

// Span formats the duration between two Unix timestamps; running spans use now.
func Span(start, end int64) string {
	if start <= 0 {
		return "—"
	}
	if end <= 0 {
		end = Now().Unix()
	}
	if end < start {
		return "—"
	}
	return Millis((end - start) * 1000)
}

// Bytes formats a byte count with binary units.
func Bytes(n int64) string {
	const unit = 1024
	if n < unit {
		return strconv.FormatInt(n, 10) + " B"
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit && exp < 4; m /= unit {
		div *= unit
		exp++
	}
	return strconv.FormatFloat(float64(n)/float64(div), 'f', 1, 64) + " " + string("KMGTP"[exp]) + "iB"
}

// Usage formats used/total with a percentage.
func Usage(used, total int64) string {
	if total <= 0 {
		return "—"
	}
	return fmt.Sprintf("%s / %s (%d%%)", Bytes(used), Bytes(total), used*100/total)
}

// Permille returns used/total in thousandths for <progress>.
func Permille(used, total int64) string {
	if total <= 0 {
		return "0"
	}
	v := used * 1000 / total
	return strconv.FormatInt(min(max(v, 0), 1000), 10)
}

// Percent formats a CPU percentage.
func Percent(v float64) string {
	return strconv.FormatFloat(v, 'f', 1, 64) + "%"
}

// CPUs formats nano-CPUs as cores.
func CPUs(nano int64) string {
	return strconv.FormatFloat(float64(nano)/1e9, 'f', -1, 64)
}

// MiB formats bytes as whole mebibytes for form inputs.
func MiB(b int64) string {
	return strconv.FormatInt(b>>20, 10)
}

// StageLabel names a pipeline stage the way people describe it.
func StageLabel(stage string) string {
	switch stage {
	case "clone":
		return "Getting code"
	case "build":
		return "Building"
	case "start":
		return "Starting"
	case "healthcheck":
		return "Checking it responds"
	case "route":
		return "Switching traffic"
	}
	return stage
}

// StagePhrase describes where a deployment stopped, for use after "Stopped".
func StagePhrase(stage string) string {
	switch stage {
	case "clone":
		return "while getting the code"
	case "build":
		return "during the build"
	case "start":
		return "while starting"
	case "healthcheck":
		return "at the health check"
	case "route":
		return "while switching traffic"
	}
	return "before finishing"
}
