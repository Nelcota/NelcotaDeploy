package web_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestServersPage(t *testing.T) {
	e := newEnv(t)
	res := e.admin().get("/servers")
	if res.code != http.StatusOK {
		t.Fatal(res.code)
	}
	mustContain(t, res.body, `id="servers-list"`, `data-server="dev-server-api"`, "Server api", "10.77.0.3", `data-chart`, `data-metric="cpu"`, `data-metric="disk-meter"`, "Build cache size", "5.0 GiB", "Builds at the same time", `data-metric="cache-meter"`, `id="free-dev-server-api"`, "Free up space", "Remove unused images", "Clear the build cache", `id="limits-dev-server-api"`, "Add server", `value="10.77.0.5"`, `&#34;dev-app-api&#34;:&#34;api&#34;`, "/assets/uplot.", "/assets/metrics.")
	member := e.member().get("/servers")
	mustNotContain(t, member.body, "Add server", `id="free-`, `id="limits-`)
}

func TestInviteServer(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	res := s.post("/ui/servers/invite", url.Values{"name": {"apps-2"}, "wireguard_ip": {"10.77.0.9"}, "build_limit": {"2"}, "cache_gib": {"2.5"}})
	if toast(res.body) == "danger" {
		t.Fatal(res.body)
	}
	mustContain(t, res.body, `elements <section id="invite-result"`, "Install the agent on apps-2", "--panel-url http://localhost:8080", "http://localhost:8080/agent.sh", "--join-file /root/nelcota-join", "data-expires=", "selector #servers-list", "mode append", `data-server="`, "RELEASE_URL")
	servers, _ := e.services().Servers.List(withUser(e, "development-user"))
	var found bool
	for _, srv := range servers {
		if srv.Name == "apps-2" {
			found = srv.BuildLimit == 2 && srv.CacheBytes == 5<<29 && srv.Status == "offline"
		}
	}
	if !found {
		t.Fatal(servers)
	}
	// The token appears only in this response, never on the page afterwards.
	var token string
	for _, line := range strings.Split(res.body, "\n") {
		if i := strings.Index(line, "printf &#39;%s\\n&#39; &#39;"); i >= 0 {
			token = strings.SplitN(line[i+len("printf &#39;%s\\n&#39; &#39;"):], "&#39;", 2)[0]
		}
	}
	if len(token) < 20 {
		t.Fatal("token not found", trim(res.body))
	}
	mustNotContain(t, s.get("/servers").body, token)

	// The panel can also run the script over SSH after the host key is confirmed.
	mustContain(t, res.body, "Or let the panel install it over SSH", `name="private_key"`, `name="token"`, "Check the server")
	var id string
	for _, srv := range servers {
		if srv.Name == "apps-2" {
			id = srv.ID
		}
	}
	bad := s.post("/ui/servers/"+id+"/ssh/check", url.Values{"host": {"-oProxyCommand=touch /tmp/x"}, "port": {"22"}, "token": {token}})
	mustContain(t, bad.body, "Enter the server&#39;s address")
	unconfirmed := s.post("/ui/servers/"+id+"/ssh/install", url.Values{"host": {"203.0.113.10"}, "port": {"22"}, "user": {"root"}, "token": {token}, "private_key": {"x"}})
	if toast(unconfirmed.body) != "danger" {
		t.Fatal("installed without a confirmed host key", unconfirmed.body)
	}
	if res := e.member().post("/ui/servers/"+id+"/ssh/check", url.Values{"host": {"203.0.113.10"}, "port": {"22"}}); toast(res.body) != "danger" {
		t.Fatal("member probed a host")
	}

	res = s.post("/ui/servers/invite", url.Values{"name": {"bad"}, "wireguard_ip": {"8.8.8.8"}, "build_limit": {"1"}, "cache_gib": {"5"}})
	mustContain(t, res.body, "Name and private IPv4 address required")
	res = e.member().post("/ui/servers/invite", url.Values{"name": {"m"}, "wireguard_ip": {"10.77.0.10"}, "build_limit": {"1"}, "cache_gib": {"5"}})
	mustContain(t, res.body, "Administrator permission required")
}

func TestServerLimitsAndPrune(t *testing.T) {
	e := newEnv(t)
	s := e.admin()
	res := s.post("/ui/servers/dev-server-api/limits", url.Values{"build_limit": {"3"}, "cache_gib": {"10"}})
	mustContain(t, res.body, `elements <div id="server-limits-dev-server-api"`, "10.0 GiB", ">3<", "Limits saved for Server api.")
	res = s.post("/ui/servers/dev-server-api/limits", url.Values{"build_limit": {"9"}, "cache_gib": {"10"}})
	if toast(res.body) != "danger" {
		t.Fatal(res.body)
	}
	res = s.post("/ui/servers/dev-server-api/limits", url.Values{"build_limit": {"1"}, "cache_gib": {"lots"}})
	mustContain(t, res.body, "Cache limit must be a number of GiB")
	// Without a connected agent the service reports it instead of pretending.
	res = s.post("/ui/servers/dev-server-api/prune/cache", nil)
	mustContain(t, res.body, "Agent unavailable")
	res = s.post("/ui/servers/dev-server-api/prune/everything", nil)
	mustContain(t, res.body, "Invalid scope")
}
