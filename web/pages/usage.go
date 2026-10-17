package pages

import (
	"strconv"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
)

// usageTotals adds up the app's containers: CPU in percent of one core (as
// Docker reports it), memory used and its limit in bytes, and the CPU the
// containers may use in nano-CPUs. An app without a CPU limit counts one core
// per container, so the meter still has a scale.
func usageTotals(app service.App, usage []Container) (cpu float64, used, limit, nanoCPUs int64) {
	per := app.Config.NanoCPUs
	if per <= 0 {
		per = 1e9
	}
	for _, u := range usage {
		cpu += u.CPUPercent
		used += u.MemoryUsed
		limit += u.MemoryLimit
		nanoCPUs += per
	}
	return cpu, used, limit, nanoCPUs
}

// permille is v as thousandths of total, clamped to 0–1000, for <progress>.
func permille(v, total float64) string {
	if total <= 0 || v <= 0 {
		return "0"
	}
	return strconv.Itoa(int(min(1000, v*1000/total)))
}
