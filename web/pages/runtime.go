package pages

import (
	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/Nelcota/NelcotaDeploy/web/ui"
)

// runtimeBrands maps a service runtime to its Simple Icons mark, where the
// slugs differ.
var runtimeBrands = map[string]string{"node": "nodedotjs", "java": "openjdk"}

// RuntimeBrand is the brand mark slug for an app runtime, or "" when unset.
func RuntimeBrand(runtime string) string {
	if runtime == "" {
		return ""
	}
	if slug, ok := runtimeBrands[runtime]; ok {
		return slug
	}
	return runtime
}

// RuntimeLabel is the product name of an app runtime.
func RuntimeLabel(runtime string) string {
	return ui.BrandTitle(RuntimeBrand(runtime))
}

// runtimeOptions are the runtimes in the settings list.
func runtimeOptions() []string { return service.Runtimes }
