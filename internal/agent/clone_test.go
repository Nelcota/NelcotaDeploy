package agent

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
)

func TestClonePreservesProxyTrustWithoutUnsafeGitEnvironment(t *testing.T) {
	toolDir := t.TempDir()
	sha := strings.Repeat("a", 40)
	script := `#!/bin/sh
test "$HTTPS_PROXY" = 'http://proxy.invalid:3128' || exit 11
test "$GIT_SSL_CAINFO" = '/runner/ca.pem' || exit 12
test "$GIT_CONFIG_GLOBAL" = '/dev/null' || exit 13
test "$GIT_CONFIG_NOSYSTEM" = '1' || exit 14
test -z "${GIT_SSL_NO_VERIFY-}" || exit 15
test -z "${GIT_TRACE-}" || exit 16
test -z "${GIT_CONFIG_COUNT-}" || exit 17
for argument in "$@"; do if test "$argument" = 'rev-parse'; then echo '` + sha + `'; fi; done
`
	if err := os.WriteFile(filepath.Join(toolDir, "git"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", toolDir)
	t.Setenv("HTTPS_PROXY", "http://proxy.invalid:3128")
	t.Setenv("SSL_CERT_FILE", "/runner/ca.pem")
	t.Setenv("GIT_SSL_CAINFO", "")
	t.Setenv("GIT_SSL_NO_VERIFY", "1")
	t.Setenv("GIT_TRACE", "1")
	t.Setenv("GIT_CONFIG_COUNT", "99")
	dep := &agentv1.Deploy{Sha: sha, App: &agentv1.AppConfig{Repository: "https://github.com/example/app"}}
	if err := (&DockerEngine{}).Clone(context.Background(), dep, t.TempDir(), func([]byte) {}); err != nil {
		t.Fatal("clone lost routing/trust or inherited unsafe environment", err)
	}
}
