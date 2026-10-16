package pages

import (
	"context"

	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"strconv"
	"strings"

	"github.com/Nelcota/NelcotaDeploy/internal/service"
)

// Stages lists pipeline stages in execution order.
var Stages = []string{"clone", "build", "start", "healthcheck", "route"}

// AppState summarizes an app for people, from its deployments.
type AppState struct {
	Key    string // live, publishing, update_failed, not_live, stopped, new
	Label  string
	Live   service.Deployment // newest successful deployment, if any
	Latest service.Deployment // newest deployment, if any
}

// StateOf derives the app's state from its deployments (newest first).
func StateOf(app service.App, deploys []service.Deployment) AppState {
	s := AppState{}
	if len(deploys) > 0 {
		s.Latest = deploys[0]
	}
	for _, d := range deploys {
		if d.Status == "success" {
			s.Live = d
			break
		}
	}
	switch {
	case app.Config.Stopped:
		s.Key, s.Label = "stopped", "Stopped"
	case s.Latest.ID != "" && (s.Latest.Status == "queued" || s.Latest.Status == "building" || s.Latest.Status == "starting"):
		s.Key, s.Label = "publishing", "Publishing"
	case s.Latest.Status == "failed" && s.Live.ID != "":
		s.Key, s.Label = "update_failed", "Update failed"
	case s.Latest.Status == "failed" || (s.Latest.ID != "" && s.Live.ID == ""):
		s.Key, s.Label = "not_live", "Not live"
	case s.Live.ID != "":
		s.Key, s.Label = "live", "Live"
	default:
		s.Key, s.Label = "new", "Not published"
	}
	return s
}

// FailedStage is the first stage without a recorded duration: where a failed
// deployment stopped.
func FailedStage(d service.Deployment) string {
	for _, st := range Stages {
		if _, ok := d.Timings[st]; !ok {
			return st
		}
	}
	return ""
}

// CurrentStage is the stage a running deployment is in.
func CurrentStage(d service.Deployment) string {
	if d.Status == "queued" {
		return ""
	}
	return FailedStage(d)
}

// StageState reports how far deployment d got with stage: "done" once the
// stage has a recorded duration, "current" for the stage a running deployment
// is in, "failed" for the stage a failed deployment stopped at, or "".
func StageState(d service.Deployment, stage string) string {
	if _, ok := d.Timings[stage]; ok {
		return "done"
	}
	switch {
	case d.Status == "failed" && FailedStage(d) == stage:
		return "failed"
	case (d.Status == "building" || d.Status == "starting") && CurrentStage(d) == stage:
		return "current"
	}
	return ""
}

// Explanation tells people what went wrong and what to do next.
type Explanation struct {
	What string
	Fix  string
}

// Explain maps a failure code to plain language using the app's settings.
func Explain(ctx context.Context, code string, app service.App) Explanation {
	e := explain(code, app)
	return Explanation{e.What.text(ctx), e.Fix.text(ctx)}
}

// sentence is an English format string and its values, translated when rendered.
type sentence struct {
	format string
	args   []any
}

func fill(format string, args ...any) sentence { return sentence{format, args} }

func (s sentence) text(ctx context.Context) string { return i18n.Tf(ctx, s.format, s.args...) }

type explanation struct {
	What sentence
	Fix  sentence
}

// explain returns the English explanation; parameterized sentences are filled
// in after translation by explainf.
func explain(code string, app service.App) explanation {
	port := strconv.FormatUint(uint64(app.Config.Port), 10)
	path := app.Config.HealthPath
	timeout := strconv.FormatUint(uint64(app.Config.HealthTimeout), 10)
	if strings.HasPrefix(code, "health_status_") {
		return explanation{
			What: fill("Your app answered with HTTP %s at %s.", strings.TrimPrefix(code, "health_status_"), path),
			Fix:  fill("The health check path must return a 2xx or 3xx status. Point it at a page that loads without signing in."),
		}
	}
	switch code {
	case "clone_failed":
		return explanation{fill("The code at this commit couldn't be downloaded."), fill("Check that the commit exists on GitHub and that the GitHub App can read the repository.")}
	case "build_failed":
		return explanation{fill("The Docker build failed."), fill("The log shows the step that failed. Running docker build . on your machine usually shows the same error.")}
	case "start_failed":
		return explanation{fill("The container couldn't start."), fill("Check the memory limit and the start command in your Dockerfile.")}
	case "app_exited":
		return explanation{fill("Your app started and then stopped."), fill("It usually crashes on startup because of a missing environment variable or a database it can't reach. The last log lines show why.")}
	case "health_no_response":
		return explanation{fill("Your app didn't answer at %s on port %s within %s seconds.", path, port, timeout), fill("Make sure it listens on port %s on all interfaces (0.0.0.0), or change the port in Settings. If it starts slowly, raise the timeout.", port)}
	case "route_failed":
		return explanation{fill("Traffic couldn't be switched to the new version."), fill("This is usually temporary. Try again, and check the server if it happens again.")}
	case "workspace_error", "state_error":
		return explanation{fill("The server couldn't prepare the deployment."), fill("Check that the server has free disk space, then try again.")}
	case "agent_unavailable":
		return explanation{fill("The server was offline when the deployment started."), fill("Check that the server is online on the Servers page, then try again.")}
	case "github_unavailable":
		return explanation{fill("GitHub didn't give access to the repository."), fill("Check the GitHub App installation for this repository in Settings › Connections.")}
	case "config_unavailable":
		return explanation{fill("The app's settings couldn't be prepared."), fill("Save the app's settings again, then try again.")}
	}
	return explanation{fill("The deployment failed."), fill("The log shows what happened.")}
}
