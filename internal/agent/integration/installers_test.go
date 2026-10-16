//go:build integration

package integration

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
)

func TestInstallerSyntaxDebianUbuntu(t *testing.T) {
	for _, image := range []string{"debian:12-slim", "ubuntu:22.04"} {
		t.Run(image, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			var files []testcontainers.ContainerFile
			names := []string{"install.sh", "agent.sh", "release.sh", "performance.sh", "compare-benchmarks.sh"}
			for _, name := range names {
				b, e := os.ReadFile(filepath.Join("..", "..", "..", "scripts", name))
				if e != nil {
					t.Fatal(e)
				}
				files = append(files, testcontainers.ContainerFile{Reader: bytes.NewReader(b), ContainerFilePath: "/scripts/" + name, FileMode: 0444})
			}
			container, e := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{ContainerRequest: testcontainers.ContainerRequest{Image: image, Files: files, Cmd: []string{"sleep", "300"}}, Started: true})
			if e != nil {
				t.Fatal(e)
			}
			defer testcontainers.TerminateContainer(container)
			for _, name := range names {
				exit, _, e := container.Exec(ctx, []string{"bash", "-n", "/scripts/" + name})
				if e != nil || exit != 0 {
					t.Fatalf("%s on %s: exit=%d error=%v", name, image, exit, e)
				}
			}
		})
	}
}
