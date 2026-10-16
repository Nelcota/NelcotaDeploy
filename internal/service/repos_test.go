package service

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestDockerfilePort(t *testing.T) {
	for text, want := range map[string]uint32{"FROM x\nEXPOSE 3000\n": 3000, "expose 8080/tcp": 8080, "FROM x": 0, "EXPOSE 99999": 0, "# EXPOSE 1\nRUN x": 0} {
		if got := DockerfilePort(text); got != want {
			t.Fatal(text, got)
		}
	}
}

func TestInspectPublicRepository(t *testing.T) {
	c, ctx, _ := fixture(t)
	sha := strings.Repeat("c", 40)
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/repos/acme/shop":
			_ = json.NewEncoder(w).Encode(map[string]any{"default_branch": "main"})
		case "/repos/acme/shop/branches":
			_ = json.NewEncoder(w).Encode([]map[string]any{{"name": "main"}, {"name": "staging"}})
		case "/repos/acme/shop/branches/main":
			_ = json.NewEncoder(w).Encode(map[string]any{"name": "main", "commit": map[string]any{"sha": sha, "commit": map[string]any{"message": "Add cart\n\nDetails", "author": map[string]any{"name": "Ana"}}}})
		case "/repos/acme/shop/contents/Dockerfile":
			if r.URL.Query().Get("ref") != sha {
				http.Error(w, "wrong ref", 400)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"type": "file", "encoding": "base64", "content": base64.StdEncoding.EncodeToString([]byte("FROM node\nEXPOSE 3000\n"))})
		default:
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"message":"Not Found"}`))
		}
	}))
	defer api.Close()
	base, _ := url.Parse(api.URL + "/")
	g := &GitHubService{Core: c, APIBase: base}
	info, e := g.Inspect(ctx, RepoQuery{Repository: "https://github.com/acme/shop"})
	if e != nil {
		t.Fatal(e)
	}
	if info.Branch != "main" || len(info.Branches) != 2 || info.Head.SHA != sha || info.Head.Message != "Add cart" || info.Head.Author != "Ana" || !info.Dockerfile || info.Port != 3000 {
		t.Fatalf("%+v", info)
	}
	if _, e := g.Inspect(ctx, RepoQuery{Repository: "https://github.com/acme/missing"}); !Is(e, NotFound) {
		t.Fatal(e)
	}
	if _, e := g.Inspect(ctx, RepoQuery{Repository: "https://evil.example/acme/shop"}); !Is(e, Validation) {
		t.Fatal("non-GitHub repository accepted", e)
	}
	if _, e := g.Inspect(WithPrincipal(ctx, Principal{}), RepoQuery{Repository: "https://github.com/acme/shop"}); !Is(e, Unauthenticated) {
		t.Fatal(e)
	}
}

func TestDockerfileHealthPathAndEnvExample(t *testing.T) {
	for in, want := range map[string]string{
		"HEALTHCHECK CMD curl -f http://localhost:8080/healthz || exit 1":       "/healthz",
		`HEALTHCHECK --interval=30s CMD ["wget","-q","http://127.0.0.1/ready"]`: "/ready",
		"HEALTHCHECK CMD curl -f https://example.com/healthz":                   "",
		"HEALTHCHECK NONE":                  "",
		"RUN curl http://localhost/healthz": "",
	} {
		if got := DockerfileHealthPath(in); got != want {
			t.Errorf("%q: %q, want %q", in, got, want)
		}
	}
	keys := EnvExampleKeys("# comment\nDATABASE_URL=postgres://x\nexport SECRET_KEY=\n\nDATABASE_URL=again\nbad key=1\nNO_VALUE\n")
	if strings.Join(keys, ",") != "DATABASE_URL,SECRET_KEY" {
		t.Fatal(keys)
	}
}

func TestInspectFindsInstallationAndReadsFiles(t *testing.T) {
	c, ctx, _ := fixture(t)
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	pemKey := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	for k, v := range map[string]string{"github.app_id": "77", "github.private_key": string(pemKey)} {
		b, _ := c.Vault.Seal([]byte(v), "setting:"+k)
		if _, e := c.DB.Write.ExecContext(ctx, "INSERT INTO settings(key,encrypted) VALUES(?,?)", k, b); e != nil {
			t.Fatal(e)
		}
	}
	sha := strings.Repeat("d", 40)
	file := func(w http.ResponseWriter, text string) {
		_ = json.NewEncoder(w).Encode(map[string]any{"type": "file", "encoding": "base64", "size": len(text), "content": base64.StdEncoding.EncodeToString([]byte(text))})
	}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		auth := r.Header.Get("Authorization")
		switch r.URL.Path {
		case "/repos/acme/private/installation":
			if !strings.HasPrefix(auth, "Bearer ") { // the App's JWT
				w.WriteHeader(401)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": 4242})
		case "/app/installations/4242/access_tokens":
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(map[string]any{"token": "ghs_installation", "expires_at": time.Now().Add(time.Hour)})
		case "/repos/acme/private", "/repos/acme/private/branches", "/repos/acme/private/branches/main", "/repos/acme/private/contents/Dockerfile", "/repos/acme/private/contents/.env.example":
			if auth != "token ghs_installation" {
				w.WriteHeader(404)
				_, _ = w.Write([]byte(`{"message":"Not Found"}`))
				return
			}
			switch {
			case strings.HasSuffix(r.URL.Path, "/branches"):
				_ = json.NewEncoder(w).Encode([]map[string]any{{"name": "main"}})
			case strings.HasSuffix(r.URL.Path, "/branches/main"):
				_ = json.NewEncoder(w).Encode(map[string]any{"name": "main", "commit": map[string]any{"sha": sha, "commit": map[string]any{"message": "Init"}}})
			case strings.HasSuffix(r.URL.Path, "/Dockerfile"):
				file(w, "FROM go\nEXPOSE 9000\nHEALTHCHECK CMD wget -qO- http://localhost:9000/up\n")
			case strings.HasSuffix(r.URL.Path, "/.env.example"):
				file(w, "API_KEY=\nREDIS_URL=redis://\n")
			default:
				_ = json.NewEncoder(w).Encode(map[string]any{"default_branch": "main", "private": true})
			}
		default:
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"message":"Not Found"}`))
		}
	}))
	defer api.Close()
	base, _ := url.Parse(api.URL + "/")
	g := &GitHubService{Core: c, APIBase: base}
	info, e := g.Inspect(ctx, RepoQuery{Repository: "https://github.com/acme/private"})
	if e != nil {
		t.Fatal(e)
	}
	if info.InstallationID != 4242 || info.Port != 9000 || info.HealthPath != "/up" || strings.Join(info.EnvKeys, ",") != "API_KEY,REDIS_URL" || info.Head.SHA != sha {
		t.Fatalf("%+v", info)
	}
}

func TestDevReposIsStable(t *testing.T) {
	_, ctx, _ := fixture(t)
	a, _ := DevRepos{}.Inspect(ctx, RepoQuery{Repository: "https://github.com/example/api", Branch: "main"})
	b, _ := DevRepos{}.Inspect(ctx, RepoQuery{Repository: "https://github.com/example/api", Branch: "main"})
	if a.Head.SHA != b.Head.SHA || !shaPattern.MatchString(a.Head.SHA) || a.Port != 8080 {
		t.Fatal(a, b)
	}
}
