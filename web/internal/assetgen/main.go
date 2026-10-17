// Command assetgen fingerprints and precompresses the panel's browser assets.
//
// It reads the Tailwind output, vendored libraries, and panel scripts, then writes
// content-hashed files with Brotli and zstd variants plus manifest.json into
// web/static/dist. Output is deterministic so CI can verify the committed copy.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/andybalholm/brotli"
	"github.com/klauspost/compress/zstd"
)

func main() {
	root := flag.String("root", "web/static", "static asset directory")
	flag.Parse()
	if err := run(*root); err != nil {
		fmt.Fprintln(os.Stderr, "assetgen:", err)
		os.Exit(1)
	}
}

func run(root string) error {
	sources := map[string]string{
		"app.css":       filepath.Join(root, "build", "app.css"),
		"datastar.js":   filepath.Join(root, "vendor", "datastar.js"),
		"xterm.js":      filepath.Join(root, "vendor", "xterm.js"),
		"xterm-fit.js":  filepath.Join(root, "vendor", "xterm-addon-fit.js"),
		"xterm.css":     filepath.Join(root, "vendor", "xterm.css"),
		"uplot.js":      filepath.Join(root, "vendor", "uplot.js"),
		"uplot.css":     filepath.Join(root, "vendor", "uplot.css"),
		"favicon.png":   filepath.Join(root, "src", "favicon.png"),
		"mascot.png":    filepath.Join(root, "src", "mascot.png"),
		"outfit.woff2":  filepath.Join(root, "vendor", "outfit.woff2"),
		"app.js":        filepath.Join(root, "src", "js", "app.js"),
		"auth.js":       filepath.Join(root, "src", "js", "auth.js"),
		"logs.js":       filepath.Join(root, "src", "js", "logs.js"),
		"metrics.js":    filepath.Join(root, "src", "js", "metrics.js"),
		"settings.js":   filepath.Join(root, "src", "js", "settings.js"),
		"cmdk.js":       filepath.Join(root, "src", "js", "cmdk.js"),
		"theme-boot.js": filepath.Join(root, "src", "js", "theme-boot.js"),
		"editor.js":     filepath.Join(root, "src", "js", "editor.js"),
	}
	dist := filepath.Join(root, "dist")
	if err := os.RemoveAll(dist); err != nil {
		return err
	}
	if err := os.MkdirAll(dist, 0o755); err != nil {
		return err
	}
	encoder, err := zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.SpeedBestCompression), zstd.WithEncoderConcurrency(1))
	if err != nil {
		return err
	}
	defer encoder.Close()
	manifest := map[string]string{}
	names := make([]string, 0, len(sources))
	for name := range sources {
		names = append(names, name)
	}
	// Stylesheets go last so they can reference other assets by hashed URL:
	// url("/__asset__/NAME") is rewritten to the fingerprinted path.
	sort.Slice(names, func(i, j int) bool {
		ci, cj := strings.HasSuffix(names[i], ".css"), strings.HasSuffix(names[j], ".css")
		if ci != cj {
			return cj
		}
		return names[i] < names[j]
	})
	for _, name := range names {
		data, err := os.ReadFile(sources[name])
		if err != nil {
			return err
		}
		if strings.HasPrefix(sources[name], filepath.Join(root, "src", "js")+string(filepath.Separator)) {
			data = stripLineComments(data)
		}
		if strings.HasSuffix(name, ".css") {
			for ref, hashed := range manifest {
				data = bytes.ReplaceAll(data, []byte("/__asset__/"+ref), []byte("/assets/"+hashed))
			}
			if bytes.Contains(data, []byte("/__asset__/")) {
				return fmt.Errorf("%s references an unknown asset", name)
			}
		}
		sum := sha256.Sum256(data)
		ext := filepath.Ext(name)
		hashed := strings.TrimSuffix(name, ext) + "." + hex.EncodeToString(sum[:5]) + ext
		manifest[name] = hashed
		if err := os.WriteFile(filepath.Join(dist, hashed), data, 0o644); err != nil {
			return err
		}
		if ext == ".woff2" || ext == ".png" {
			continue // already compressed
		}
		var br bytes.Buffer
		w := brotli.NewWriterLevel(&br, brotli.BestCompression)
		if _, err := w.Write(data); err != nil {
			return err
		}
		if err := w.Close(); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dist, hashed+".br"), br.Bytes(), 0o644); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dist, hashed+".zst"), encoder.EncodeAll(data, nil), 0o644); err != nil {
			return err
		}
	}
	b, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dist, "manifest.json"), append(b, '\n'), 0o644)
}

// stripLineComments drops lines that are only a // comment from the panel's
// own scripts. It never touches code lines, so it can't change behavior; the
// scripts have no multi-line strings that could contain such a line.
func stripLineComments(src []byte) []byte {
	var out bytes.Buffer
	for line := range bytes.Lines(src) {
		if bytes.HasPrefix(bytes.TrimSpace(line), []byte("//")) {
			continue
		}
		out.Write(line)
	}
	return out.Bytes()
}
