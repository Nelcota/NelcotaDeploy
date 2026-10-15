package agent

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/distribution/reference"
	bk "github.com/moby/buildkit/client"
	"github.com/moby/buildkit/client/llb"
	"github.com/moby/buildkit/frontend/dockerfile/parser"
	"github.com/moby/buildkit/frontend/dockerfile/shell"
)

type baseRecord struct {
	Seen      int64 `json:"seen"`
	Refreshed int64 `json:"refreshed"`
}

// Bases records validated Dockerfile references, never credentials or build
// secrets. Digest-pinned images and earlier build stages cannot be refreshed.
func baseReferences(r io.Reader) ([]string, error) {
	ast, e := parser.Parse(io.LimitReader(r, (1<<20)+1))
	if e != nil {
		return nil, e
	}
	env := []string{"TARGETARCH=" + runtime.GOARCH, "BUILDARCH=" + runtime.GOARCH, "TARGETOS=linux", "BUILDOS=linux", "TARGETPLATFORM=linux/" + runtime.GOARCH, "BUILDPLATFORM=linux/" + runtime.GOARCH}
	lex := shell.NewLex(ast.EscapeToken)
	aliases := map[string]bool{}
	seen := map[string]bool{}
	out := []string{}
	beforeFrom := true
	for _, n := range ast.AST.Children {
		if strings.EqualFold(n.Value, "arg") && beforeFrom {
			for a := n.Next; a != nil; a = a.Next {
				key, value, ok := strings.Cut(a.Value, "=")
				if ok {
					expanded, _, e := lex.ProcessWord(value, shell.EnvsFromSlice(env))
					if e == nil {
						env = append(env, key+"="+expanded)
					}
				}
			}
			continue
		}
		if !strings.EqualFold(n.Value, "from") || n.Next == nil {
			continue
		}
		beforeFrom = false
		ref, _, e := lex.ProcessWord(n.Next.Value, shell.EnvsFromSlice(env))
		if e != nil {
			continue
		}
		alias := strings.ToLower(ref)
		_, numeric := strconv.Atoi(ref)
		if alias != "scratch" && !aliases[alias] && numeric != nil && !strings.Contains(ref, "@") {
			named, e := reference.ParseNormalizedNamed(ref)
			if e == nil {
				normalized := reference.TagNameOnly(named).String()
				if !seen[normalized] && len(out) < 256 {
					seen[normalized] = true
					out = append(out, normalized)
				}
			}
		}
		if next := n.Next.Next; next != nil && strings.EqualFold(next.Value, "as") && next.Next != nil {
			aliases[strings.ToLower(next.Next.Value)] = true
		}
	}
	return out, nil
}
func (d *DockerEngine) recordBases(ctx context.Context, dir, dockerfile string) error {
	if d.BaseImagesPath == "" {
		return nil
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	root, e := os.OpenRoot(dir)
	if e != nil {
		return e
	}
	defer root.Close()
	f, e := root.Open(dockerfile)
	if e != nil {
		return e
	}
	defer f.Close()
	refs, e := baseReferences(f)
	if e != nil {
		return e
	}
	d.baseMu.Lock()
	defer d.baseMu.Unlock()
	records, e := d.loadBases()
	if e != nil {
		return e
	}
	now := time.Now().Unix()
	for _, ref := range refs {
		v := records[ref]
		v.Seen = now
		records[ref] = v
	}
	return d.saveBases(records)
}
func (d *DockerEngine) loadBases() (map[string]baseRecord, error) {
	records := map[string]baseRecord{}
	f, e := os.Open(d.BaseImagesPath)
	if os.IsNotExist(e) {
		return records, nil
	}
	if e != nil {
		return nil, e
	}
	defer f.Close()
	if e = json.NewDecoder(io.LimitReader(f, 128<<10)).Decode(&records); e != nil {
		return nil, errors.New("invalid base image catalog")
	}
	if len(records) > 512 {
		return nil, errors.New("base image catalog too large")
	}
	return records, nil
}
func (d *DockerEngine) saveBases(records map[string]baseRecord) error {
	cutoff := time.Now().Add(-90 * 24 * time.Hour).Unix()
	for ref, v := range records {
		if v.Seen < cutoff {
			delete(records, ref)
		}
	}
	if len(records) > 256 {
		refs := make([]string, 0, len(records))
		for ref := range records {
			refs = append(refs, ref)
		}
		sort.Slice(refs, func(i, j int) bool { return records[refs[i]].Seen > records[refs[j]].Seen })
		for _, ref := range refs[256:] {
			delete(records, ref)
		}
	}
	if e := os.MkdirAll(filepath.Dir(d.BaseImagesPath), 0700); e != nil {
		return e
	}
	b, e := json.Marshal(records)
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(d.BaseImagesPath), ".bases-")
	if e != nil {
		return e
	}
	defer func() { _ = f.Close(); _ = os.Remove(f.Name()) }()
	if _, e = f.Write(b); e != nil {
		return e
	}
	if e = f.Sync(); e != nil {
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	return os.Rename(f.Name(), d.BaseImagesPath)
}

// RefreshBases refreshes due tags in BuildKit's own content store, with no RUN,
// image export or application restart. The filesystem operation materializes
// the base layers; Docker ImagePull would populate a different content store.
func (d *DockerEngine) RefreshBases(ctx context.Context, now time.Time, refresh func(context.Context, string) error) error {
	if refresh == nil {
		refresh = d.prewarmBase
	}
	d.baseMu.Lock()
	records, e := d.loadBases()
	d.baseMu.Unlock()
	if e != nil {
		return e
	}
	refs := []string{}
	for ref, v := range records {
		if v.Refreshed == 0 || now.Unix()-v.Refreshed >= 7*24*60*60 {
			refs = append(refs, ref)
		}
	}
	sort.Strings(refs)
	if len(refs) > 32 {
		refs = refs[:32]
	}
	failed := false
	for _, ref := range refs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if _, e = reference.ParseNormalizedNamed(ref); e != nil || strings.Contains(ref, "@") {
			continue
		}
		run, cancel := context.WithTimeout(ctx, 2*time.Minute)
		e = refresh(run, ref)
		cancel()
		if e != nil {
			failed = true
			continue
		}
		d.baseMu.Lock()
		current, err := d.loadBases()
		if err == nil {
			v, exists := current[ref]
			if exists {
				v.Refreshed = now.Unix()
				current[ref] = v
				err = d.saveBases(current)
			}
		}
		d.baseMu.Unlock()
		if err != nil {
			return err
		}
	}
	if failed {
		return errors.New("base image refresh incomplete")
	}
	return nil
}
func (d *DockerEngine) prewarmBase(ctx context.Context, ref string) error {
	state := llb.Image(ref, llb.ResolveModeForcePull).File(llb.Mkdir("/.nelcota-base-cache", 0755))
	definition, e := state.Marshal(ctx)
	if e != nil {
		return e
	}
	_, e = d.BuildKit.Solve(ctx, definition, bk.SolveOpt{}, nil)
	return e
}
func (d *DockerEngine) RunMaintenance(ctx context.Context, idle func() bool, report func(error)) error {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		if idle() {
			run, cancel := context.WithTimeout(ctx, 10*time.Minute)
			if e := d.RefreshBases(run, time.Now(), d.prewarmBase); e != nil && ctx.Err() == nil {
				report(e)
			}
			cancel()
		}
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
	}
}
