//go:build integration

package updater

import (
	legacycontainer "github.com/docker/docker/api/types/container"
	"github.com/nelcota/nelcota-deploy/internal/testinfra"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"io"
	"strings"
	"testing"
	"time"
)

func TestOfficialMinisignInteroperability(t *testing.T) {
	ctx := t.Context()
	c, e := testcontainers.Run(ctx, "debian:12-slim", testcontainers.WithEnv(testinfra.Environment()), testcontainers.WithHostConfigModifier(func(h *legacycontainer.HostConfig) { h.ExtraHosts = append(h.ExtraHosts, testinfra.Hosts()...) }), testcontainers.WithFiles(testinfra.Files()...), testcontainers.WithCmd("sh", "-ec", `apt-get update -qq && apt-get install -y -qq minisign >/dev/null
printf 'interoperability fixture\n' > /message
minisign -G -W -p /public -s /secret
minisign -S -W -s /secret -m /message -x /signature`), testcontainers.WithWaitStrategy(wait.ForExit().WithExitTimeout(90*time.Second)))
	if e != nil {
		t.Fatal(e)
	}
	testcontainers.CleanupContainer(t, c)
	state, e := c.State(ctx)
	if e != nil || state.ExitCode != 0 {
		t.Fatal("minisign fixture failed", e)
	}
	read := func(path string) []byte {
		r, e := c.CopyFileFromContainer(ctx, path)
		if e != nil {
			t.Fatal(e)
		}
		defer r.Close()
		b, e := io.ReadAll(r)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	public := strings.Fields(string(read("/public")))
	if len(public) < 1 {
		t.Fatal("missing public key")
	}
	key := public[len(public)-1]
	if e = VerifyMinisign(read("/message"), read("/signature"), key); e != nil {
		t.Fatal(e)
	}
}
