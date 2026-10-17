package web

import (
	"net/url"
	"testing"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
)

func TestParseDotenv(t *testing.T) {
	vars, err := parseDotenv("# comment\n\nA=1\nexport B = \"two words\"\nC='x=y'\nD=\n", true)
	if err != nil || len(vars) != 4 {
		t.Fatal(vars, err)
	}
	want := []service.EnvInput{{Key: "A", Value: "1", Build: true}, {Key: "B", Value: "two words", Build: true}, {Key: "C", Value: "x=y", Build: true}, {Key: "D", Value: "", Build: true}}
	for i := range want {
		if vars[i] != want[i] {
			t.Fatal(i, vars[i])
		}
	}
	if _, err := parseDotenv("NOEQUALS", false); err == nil {
		t.Fatal("accepted a line without =")
	}
	if _, err := parseDotenv("# only comments", false); err == nil {
		t.Fatal("accepted empty input")
	}
}

func TestAppInputKeepsUneditedFields(t *testing.T) {
	form := url.Values{"name": {" api "}, "repository": {"https://github.com/o/r/"}, "branch": {"main"}, "dockerfile": {"Dockerfile"}, "health_path": {"/up"}, "domains": {"A.example.com\r\nb.example.com, c.example.com."}, "port": {"3000"}, "health_timeout": {"30"}, "replicas": {"2"}, "memory_mib": {"512"}, "cpus": {"1.5"}, "installation_id": {"42"}}
	in, err := appInput(form, service.AppConfig{Stopped: true, CacheEnabled: true})
	if err != nil {
		t.Fatal(err)
	}
	c := in.Config
	if in.Name != "api" || in.Repository != "https://github.com/o/r" || !c.Stopped || c.CacheEnabled || c.Port != 3000 || c.Replicas != 2 || c.MemoryBytes != 512<<20 || c.NanoCPUs != 1_500_000_000 || c.InstallationID != 42 || len(c.Domains) != 3 || c.Domains[0] != "a.example.com" || c.Domains[2] != "c.example.com" {
		t.Fatalf("%+v", in)
	}
	for field, value := range map[string]string{"port": "x", "cpus": "0", "memory_mib": "-1", "installation_id": "-3", "replicas": "1.5"} {
		bad := url.Values{}
		for k, v := range form {
			bad[k] = v
		}
		bad.Set(field, value)
		if _, err := appInput(bad, service.AppConfig{}); !service.Is(err, service.Validation) {
			t.Fatal(field, err)
		}
	}
}

func TestSafeNextStaysOnThisOrigin(t *testing.T) {
	for in, want := range map[string]string{
		"/apps/x?tab=logs":     "/apps/x?tab=logs",
		"":                     "/",
		"apps":                 "/",
		"//evil.example":       "/",
		"/\\evil.example":      "/",
		"https://evil.example": "/",
		"/a\r\nLocation: x":    "/",
		"/\t/evil.example":     "/",
		"/\n/evil.example":     "/",
		"/ /evil.example":      "/",
	} {
		if got := safeNext(in); got != want {
			t.Errorf("safeNext(%q) = %q, want %q", in, got, want)
		}
	}
}
