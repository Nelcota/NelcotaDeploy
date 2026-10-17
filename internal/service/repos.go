package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"slices"
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

// Commit is one commit of a repository: a branch head or a recent commit.
type Commit struct {
	SHA     string `json:"sha"`
	Message string `json:"message"`
	Author  string `json:"author"`
	// Date is the author date in Unix seconds, when known.
	Date int64 `json:"date,omitempty"`
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
	// Runtime is the language or server the Dockerfile builds on (see Runtimes).
	Runtime string `json:"runtime,omitempty"`
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
	// Commits lists the newest commits on the query's branch, newest first.
	Commits(context.Context, RepoQuery) ([]Commit, error)
	// Commit finds the commit a SHA or SHA prefix (at least 7 characters) names.
	Commit(context.Context, RepoQuery, string) (Commit, error)
}

// RecentCommits is how many commits Commits lists.
const RecentCommits = 10

// shaPrefix is a full or abbreviated commit SHA.
var shaPrefix = regexp.MustCompile(`^[0-9a-fA-F]{7,64}$`)

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

// Runtimes are the languages and servers an app can be marked with. The
// interface shows each one's official mark.
var Runtimes = []string{"node", "bun", "deno", "go", "python", "rust", "ruby", "php", "java", "dotnet", "elixir", "erlang", "nginx", "caddy", "apache"}

var fromPattern = regexp.MustCompile(`(?im)^\s*FROM\s+(?:--\S+\s+)*(\S+)`)

// runtimeImages maps an image's last path element (without tag or digest) to a
// runtime. Languages come first: a Go app usually builds on golang and ships
// on distroless or scratch, so the language stage names it.
var runtimeImages = []struct {
	runtime string
	names   []string
}{
	{"node", []string{"node", "nodejs"}},
	{"bun", []string{"bun"}},
	{"deno", []string{"deno"}},
	{"go", []string{"golang", "go"}},
	{"python", []string{"python", "pypy"}},
	{"rust", []string{"rust"}},
	{"ruby", []string{"ruby", "jruby"}},
	{"php", []string{"php", "php-fpm", "composer", "frankenphp"}},
	{"java", []string{"openjdk", "eclipse-temurin", "amazoncorretto", "maven", "gradle", "jdk", "jre", "java"}},
	{"dotnet", []string{"sdk", "aspnet", "runtime", "runtime-deps", "dotnet"}},
	{"elixir", []string{"elixir"}},
	{"erlang", []string{"erlang"}},
	{"nginx", []string{"nginx", "nginx-unprivileged"}},
	{"caddy", []string{"caddy"}},
	{"apache", []string{"httpd"}},
}

// DockerfileRuntime names the runtime a Dockerfile builds on, from its FROM
// images, or "" when none is recognized. .NET images are only recognized under
// mcr.microsoft.com/dotnet, since names like "sdk" are too generic elsewhere.
func DockerfileRuntime(dockerfile string) string {
	var images []string
	for _, m := range fromPattern.FindAllStringSubmatch(dockerfile, -1) {
		ref := strings.ToLower(m[1])
		if i := strings.IndexAny(ref, "@"); i >= 0 {
			ref = ref[:i]
		}
		parts := strings.Split(ref, "/")
		name := parts[len(parts)-1]
		if i := strings.Index(name, ":"); i >= 0 {
			name = name[:i]
		}
		if strings.Contains(ref, "mcr.microsoft.com/dotnet/") {
			name = "dotnet"
		}
		// Distroless images add a version and a base: nodejs22-debian12, python3.
		first, _, _ := strings.Cut(name, "-")
		images = append(images, strings.TrimRight(name, "0123456789."), strings.TrimRight(first, "0123456789."))
	}
	for _, r := range runtimeImages {
		for _, name := range r.names {
			if r.runtime == "dotnet" && name != "dotnet" {
				continue
			}
			if slices.Contains(images, name) {
				return r.runtime
			}
		}
	}
	return ""
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
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, owner, name, e := g.repoClient(ctx, &q)
	if e != nil {
		return RepoInfo{}, e
	}
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
		info.Runtime = DockerfileRuntime(text)
	}
	if text, ok := readFile(ctx, client, owner, name, ".env.example", info.Head.SHA); ok {
		info.EnvKeys = EnvExampleKeys(text)
	}
	return info, nil
}

// repoClient authorizes the caller and returns a GitHub client that can read
// the repository: through the GitHub App installation that covers it, found
// automatically when q has none, or anonymously for public repositories.
func (g *GitHubService) repoClient(ctx context.Context, q *RepoQuery) (*github.Client, string, string, error) {
	if _, e := authorize(ctx, "apps:read", false); e != nil {
		return nil, "", "", e
	}
	owner, name, e := repoParts(q.Repository)
	if e != nil {
		return nil, "", "", e
	}
	if q.InstallationID == 0 {
		q.InstallationID = g.findInstallation(ctx, owner, name)
	}
	tr := g.baseTransport()
	if q.InstallationID > 0 {
		inst, e := g.installation(ctx, q.InstallationID)
		if e != nil {
			return nil, "", "", fail(Unavailable, "GitHub App is not configured")
		}
		tr = inst
	}
	return g.client(tr), owner, name, nil
}

func commitOf(c *github.RepositoryCommit) Commit {
	author := c.GetCommit().GetAuthor()
	out := Commit{SHA: c.GetSHA(), Message: firstLine(c.GetCommit().GetMessage()), Author: author.GetName()}
	if !author.GetDate().IsZero() {
		out.Date = author.GetDate().Unix()
	}
	return out
}

// Commits lists the newest commits on the query's branch through the GitHub API.
func (g *GitHubService) Commits(ctx context.Context, q RepoQuery) ([]Commit, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, owner, name, e := g.repoClient(ctx, &q)
	if e != nil {
		return nil, e
	}
	list, _, e := client.Repositories.ListCommits(ctx, owner, name, &github.CommitsListOptions{SHA: q.Branch, ListOptions: github.ListOptions{PerPage: RecentCommits}})
	if e != nil {
		return nil, githubError(e)
	}
	out := make([]Commit, 0, len(list))
	for _, c := range list {
		if shaPattern.MatchString(c.GetSHA()) {
			out = append(out, commitOf(c))
		}
	}
	return out, nil
}

// Commit resolves a full or abbreviated SHA to the repository's commit.
func (g *GitHubService) Commit(ctx context.Context, q RepoQuery, ref string) (Commit, error) {
	if !shaPrefix.MatchString(ref) {
		return Commit{}, fail(Validation, "Enter at least 7 characters of a commit SHA")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, owner, name, e := g.repoClient(ctx, &q)
	if e != nil {
		return Commit{}, e
	}
	c, _, e := client.Repositories.GetCommit(ctx, owner, name, strings.ToLower(ref), nil)
	if e != nil {
		var er *github.ErrorResponse
		if errors.As(e, &er) && er.Response != nil && (er.Response.StatusCode == http.StatusNotFound || er.Response.StatusCode == http.StatusUnprocessableEntity) {
			return Commit{}, fail(NotFound, "No commit with that SHA was found in the repository")
		}
		return Commit{}, githubError(e)
	}
	out := commitOf(c)
	if !shaPattern.MatchString(out.SHA) || !strings.HasPrefix(out.SHA, strings.ToLower(ref)) {
		return Commit{}, fail(NotFound, "No commit with that SHA was found in the repository")
	}
	return out, nil
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
	commits := devCommits(name, branch)
	return RepoInfo{DefaultBranch: "main", Branches: []string{"main", "develop"}, Branch: branch, Head: commits[0], Dockerfile: true, Port: 8080, Runtime: "node", EnvKeys: []string{"DATABASE_URL", "SECRET_KEY"}}, nil
}

// devCommits is a repository's simulated history: stable SHAs per repository
// and branch, so "Publish latest" and the commit list are repeatable.
func devCommits(name, branch string) []Commit {
	if branch == "" {
		branch = "main"
	}
	messages := []string{"Update the landing page", "Update dependencies", "Fix the signup form", "Add a health endpoint", "Improve request logging"}
	base := time.Now().Truncate(time.Hour).Unix()
	out := make([]Commit, len(messages))
	for i, m := range messages {
		key := name + "/" + branch
		if i > 0 {
			key += "/" + strconv.Itoa(i)
		}
		sum := sha256.Sum256([]byte(key))
		out[i] = Commit{SHA: hex.EncodeToString(sum[:20]), Message: m, Author: "Development", Date: base - int64(i)*3*3600}
	}
	return out
}

// Commits returns the simulated history of the repository's branch.
func (DevRepos) Commits(ctx context.Context, q RepoQuery) ([]Commit, error) {
	if _, e := authorize(ctx, "apps:read", false); e != nil {
		return nil, e
	}
	_, name, e := repoParts(q.Repository)
	if e != nil {
		return nil, e
	}
	return devCommits(name, q.Branch), nil
}

// Commit finds a simulated commit by SHA prefix. Full SHAs outside the
// simulated history (such as the failing "dead…" commits) are accepted as is.
func (r DevRepos) Commit(ctx context.Context, q RepoQuery, ref string) (Commit, error) {
	if !shaPrefix.MatchString(ref) {
		return Commit{}, fail(Validation, "Enter at least 7 characters of a commit SHA")
	}
	list, e := r.Commits(ctx, q)
	if e != nil {
		return Commit{}, e
	}
	ref = strings.ToLower(ref)
	for _, c := range list {
		if strings.HasPrefix(c.SHA, ref) {
			return c, nil
		}
	}
	if shaPattern.MatchString(ref) {
		return Commit{SHA: ref, Author: "Development"}, nil
	}
	return Commit{}, fail(NotFound, "No commit with that SHA was found in the repository")
}
