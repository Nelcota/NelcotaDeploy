package agent

import (
	"context"
	"errors"
	agentv1 "github.com/Nelcota/NelcotaDeploy/internal/gen/agent/v1"
	"github.com/Nelcota/NelcotaDeploy/internal/security"
	"github.com/moby/moby/api/types/container"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBaseImageParsingWeeklyRefreshAndRetry(t *testing.T) {
	input := `ARG VERSION=3.22
ARG BASE=alpine:${VERSION}
FROM --platform=$BUILDPLATFORM ${BASE} AS build
RUN echo hello
FROM build AS copy
FROM scratch AS empty
FROM busybox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa AS pinned
FROM node:22-alpine
`
	refs, e := baseReferences(strings.NewReader(input))
	if e != nil || len(refs) != 2 || refs[0] != "docker.io/library/alpine:3.22" || refs[1] != "docker.io/library/node:22-alpine" {
		t.Fatal(refs, e)
	}
	d := &DockerEngine{BaseImagesPath: filepath.Join(t.TempDir(), "bases.json")}
	root := t.TempDir()
	_ = os.WriteFile(filepath.Join(root, "Dockerfile"), []byte(input), 0600)
	if e = d.recordBases(t.Context(), root, "Dockerfile"); e != nil {
		t.Fatal(e)
	}
	count := 0
	refresh := func(context.Context, string) error { count++; return nil }
	now := time.Now()
	if e = d.RefreshBases(t.Context(), now, refresh); e != nil || count != 2 {
		t.Fatal(count, e)
	}
	if e = d.RefreshBases(t.Context(), now.Add(6*24*time.Hour), refresh); e != nil || count != 2 {
		t.Fatal("refreshed early", count, e)
	}
	if e = d.RefreshBases(t.Context(), now.Add(8*24*time.Hour), refresh); e != nil || count != 4 {
		t.Fatal(count, e)
	}
	if e = d.RefreshBases(t.Context(), now.Add(16*24*time.Hour), func(context.Context, string) error { return errors.New("unavailable") }); e == nil {
		t.Fatal("refresh failure hidden")
	}
	if e = d.RefreshBases(t.Context(), now.Add(16*24*time.Hour), refresh); e != nil || count != 6 {
		t.Fatal("refresh was not retried", count, e)
	}
	// Filesystem-root confinement prevents a repository Dockerfile symlink escaping.
	outside := filepath.Join(t.TempDir(), "secret")
	_ = os.WriteFile(outside, []byte("FROM secret:latest\n"), 0600)
	_ = os.Symlink(outside, filepath.Join(root, "escape"))
	if e = d.recordBases(t.Context(), root, "escape"); e == nil {
		t.Fatal("Dockerfile escaped context")
	}
}
func TestContainerMetricDeltasAndCounterReset(t *testing.T) {
	s := container.StatsResponse{}
	s.CPUStats = container.CPUStats{CPUUsage: container.CPUUsage{TotalUsage: 250}, SystemUsage: 1000, OnlineCPUs: 2}
	s.MemoryStats.Usage = 500
	s.MemoryStats.Limit = 1000
	s.MemoryStats.Stats = map[string]uint64{"inactive_file": 100}
	s.PidsStats.Current = 3
	m := containerMetrics("app", "container", s, container.CPUStats{CPUUsage: container.CPUUsage{TotalUsage: 200}, SystemUsage: 500})
	if m.CpuPercent != 20 || m.MemoryUsed != 400 || m.Pids != 3 {
		t.Fatal(m)
	}
	m = containerMetrics("app", "container", s, container.CPUStats{CPUUsage: container.CPUUsage{TotalUsage: 300}, SystemUsage: 1100})
	if m.CpuPercent != 0 {
		t.Fatal("counter underflow", m)
	}
}
func TestSnapshotLimitsAndBusyUpdate(t *testing.T) {
	v, _ := security.NewVault(make([]byte, 32))
	p, e := NewPipeline(&fakeEngine{}, &StateStore{Path: filepath.Join(t.TempDir(), "state"), Vault: v}, t.TempDir(), 1)
	if e != nil {
		t.Fatal(e)
	}
	if e = p.Handle(t.Context(), &agentv1.Command{Desired: &agentv1.Snapshot{Limits: &agentv1.ServerLimits{BuildLimit: 3, CacheBytes: 1 << 30}}}, func(*agentv1.Event) error { return nil }); e != nil || p.Limit != 3 {
		t.Fatal(e, p.Limit)
	}
	p.mu.Lock()
	p.active["active"] = active{app: "app"}
	p.mu.Unlock()
	called := false
	p.QueueUpdate = func(string, string) error { called = true; return nil }
	var result *agentv1.OperationResult
	e = p.Handle(t.Context(), &agentv1.Command{Action: &agentv1.Command_Update{Update: &agentv1.Update{Id: "u", Version: "v1.0.0"}}}, func(e *agentv1.Event) error { result = e.GetOperationResult(); return nil })
	if e != nil || called || result.Status != "busy" {
		t.Fatal(e, called, result)
	}
}
