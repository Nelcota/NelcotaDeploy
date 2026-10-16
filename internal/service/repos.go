package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/go-github/v75/github"
)

// RepoQuery identifies a repository to inspect before creating or deploying an app.
type RepoQuery struct {
	Repository     string `json:"repository"`
	Branch         string `json:"branch"`
	Dockerfile     string `json:"dockerfile"`
	InstallationID int64  `json:"installation_id"`
}

// Commit is the head of a branch.
type Commit struct {
	SHA     string `json:"sha"`
	Message string `json:"message"`
	Author  string `json:"author"`
}

// RepoInfo is what the panel can learn about a repository without cloning it.
type RepoInfo struct {
	DefaultBranch string   `json:"default_branch"`
	Branches      []string `json:"branches"`
	Branch        string   `json:"branch"`
	Head          Commit   `json:"head"`
	Dockerfile    bool     `json:"dockerfile"`
	Port          uint32   `json:"port"`
	// HealthPath comes from the Dockerfile's HEALTHCHECK, when it checks a local URL.
	HealthPath string `json:"health_path,omitempty"`
	// EnvKeys are the variables .env.example declares (values are never read).
	EnvKeys []string `json:"env_keys"`
	// InstallationID is the GitHub App installation that can read the
	// repository, found automatically when the App is configured.
	InstallationID int64 `json:"installation_id,omitempty"`
}

// Repos inspects source repositories. It is optional: nil when the panel has no
// GitHub access, in which case the interface asks for values directly.
type Repos interface {
	Inspect(context.Context, RepoQuery) (RepoInfo, error)
}

var (
	exposePattern      = regexp.MustCompile(`(?im)^\s*EXPOSE\s+(\d{1,5})`)
	healthcheckPattern = regexp.MustCompile(`(?im)^\s*HEALTHCHECK\b[^\n]*?https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{1,5})?(/[^\s"'\]\\]*)`)
)

// maxEnvKeys bounds what .env.example can contribute to the interface.
const maxEnvKeys = 100

// DockerfileHealthPath returns the path a HEALTHCHECK requests on the
// container itself (for example curl -f http://localhost:8080/healthz), or "".
func DockerfileHealthPath(dockerfile string) string {
	m := healthcheckPattern.FindStringSubmatch(dockerfile)
	if m == nil || len(m[1]) > 200 || strings.HasPrefix(m[1], "//") {
		return ""
	}
	return m[1]
}

// EnvExampleKeys returns the variable names in a .env.example file, in order
// and without duplicates. Values are ignored.
func EnvExampleKeys(text string) []string {
	keys := []string{}
	seen := map[string]bool{}
	for line := range strings.Lines(text) {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, _, ok := strings.Cut(strings.TrimPrefix(line, "export "), "=")
		key = strings.TrimSpace(key)
		if !ok || !envPattern.MatchString(key) || seen[key] {
			continue
		}
		seen[key] = true
		keys = append(keys, key)
		if len(keys) == maxEnvKeys {
			break
		}
	}
	return keys
}

// DockerfilePort returns the first port in an EXPOSE instruction, or zero.
func DockerfilePort(dockerfile string) uint32 {
	m := exposePattern.FindStringSubmatch(dockerfile)
	if m == nil {
		return 0
	}
	n, e := strconv.ParseUint(m[1], 10, 32)
	if e != nil || n == 0 || n > 65535 {
		return 0
	}
	return uint32(n)
}

func repoParts(repository string) (string, string, error) {
	in := AppInput{Name: "x", Branch: "main", Repository: strings.TrimSuffix(strings.TrimSpace(repository), "/")}
	if e := validateApp(&in); e != nil {
		return "", "", e
	}
	u, _ := url.Parse(in.Repository)
	parts := strings.Split(strings.Trim(strings.TrimSuffix(u.Path, ".git"), "/"), "/")
	return parts[0], parts[1], nil
}

// Inspect reads branches, the branch head, the Dockerfile, and .env.example
// through the GitHub API. Without an installation ID it looks for the GitHub
// App installation that covers the repository; public repositories also work
// without one.
func (g *GitHubService) Inspect(ctx context.Context, q RepoQuery) (RepoInfo, error) {
	if _, e := authorize(ctx, "apps:read", false); e != nil {
		return RepoInfo{}, e
	}
	owner, name, e := repoParts(q.Repository)
	if e != nil {
		return RepoInfo{}, e
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if q.InstallationID == 0 {
		q.InstallationID = g.findInstallation(ctx, owner, name)
	}
	tr := g.baseTransport()
	if q.InstallationID > 0 {
		inst, e := g.installation(ctx, q.InstallationID)
		if e != nil {
			return RepoInfo{}, fail(Unavailable, "GitHub App is not configured")
		}
		tr = inst
	}
	client := g.client(tr)
	repo, _, e := client.Repositories.Get(ctx, owner, name)
	if e != nil {
		return RepoInfo{}, githubError(e)
	}
	info := RepoInfo{DefaultBranch: repo.GetDefaultBranch(), Branch: q.Branch, Branches: []string{}, EnvKeys: []string{}, InstallationID: q.InstallationID}
	if info.Branch == "" {
		info.Branch = info.DefaultBranch
	}
	branches, _, e := client.Repositories.ListBranches(ctx, owner, name, &github.BranchListOptions{ListOptions: github.ListOptions{PerPage: 100}})
	if e != nil {
		return RepoInfo{}, githubError(e)
	}
	for _, b := range branches {
		info.Branches = append(info.Branches, b.GetName())
	}
	branch, _, e := client.Repositories.GetBranch(ctx, owner, name, info.Branch, 1)
	if e != nil {
		return RepoInfo{}, githubError(e)
	}
	c := branch.GetCommit()
	info.Head = Commit{SHA: c.GetSHA(), Message: firstLine(c.GetCommit().GetMessage()), Author: c.GetCommit().GetAuthor().GetName()}
	path := q.Dockerfile
	if path == "" {
		path = "Dockerfile"
	}
	if text, ok := readFile(ctx, client, owner, name, path, info.Head.SHA); ok {
		info.Dockerfile = true
		info.Port = DockerfilePort(text)
		info.HealthPath = DockerfileHealthPath(text)
	}
	if text, ok := readFile(ctx, client, owner, name, ".env.example", info.Head.SHA); ok {
		info.EnvKeys = EnvExampleKeys(text)
	}
	return info, nil
}

// maxInspectedFile bounds files read during inspection.
const maxInspectedFile = 256 << 10

// readFile returns a small text file at a commit, or false when it is missing
// or too large.
func readFile(ctx context.Context, client *github.Client, owner, name, path, ref string) (string, bool) {
	file, _, _, e := client.Repositories.GetContents(ctx, owner, name, path, &github.RepositoryContentGetOptions{Ref: ref})
	if e != nil || file == nil || file.GetSize() > maxInspectedFile {
		return "", false
	}
	text, e := file.GetContent()
	return text, e == nil
}

func firstLine(s string) string {
	s, _, _ = strings.Cut(s, "\n")
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

// githubError turns API failures into messages people can act on.
func githubError(e error) error {
	var er *github.ErrorResponse
	if errors.As(e, &er) && er.Response != nil {
		switch er.Response.StatusCode {
		case http.StatusNotFound:
			return fail(NotFound, "Repository or branch not found. Private repositories need the GitHub App installation ID.")
		case http.StatusUnauthorized, http.StatusForbidden:
			return fail(Unavailable, "GitHub refused the request. Check the GitHub App installation or try again later.")
		}
	}
	var rl *github.RateLimitError
	if errors.As(e, &rl) {
		return fail(Unavailable, "GitHub's rate limit was reached. Try again in a few minutes.")
	}
	return fail(Unavailable, "GitHub is unavailable")
}

// DevRepos simulates repository inspection in development mode.
type DevRepos struct{}

func (DevRepos) Inspect(ctx context.Context, q RepoQuery) (RepoInfo, error) {
	if _, e := authorize(ctx, "apps:read", false); e != nil {
		return RepoInfo{}, e
	}
	_, name, e := repoParts(q.Repository)
	if e != nil {
		return RepoInfo{}, e
	}
	branch := q.Branch
	if branch == "" {
		branch = "main"
	}
	// A stable fake SHA per repository and branch, so "Publish latest" is repeatable.
	sum := sha256.Sum256([]byte(name + "/" + branch))
	sha := hex.EncodeToString(sum[:20])
	return RepoInfo{DefaultBranch: "main", Branches: []string{"main", "develop"}, Branch: branch, Head: Commit{SHA: sha, Message: "Latest commit on " + branch, Author: "Development"}, Dockerfile: true, Port: 8080, EnvKeys: []string{"DATABASE_URL", "SECRET_KEY"}}, nil
}
