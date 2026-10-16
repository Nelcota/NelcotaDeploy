# Interface writing guide

The panel is used by people who want their app online, not by people who want to learn BuildKit. Every screen answers "is it working?" and "what do I do now?". Review interface changes against this page.

## Voice

- Write the way a knowledgeable colleague talks: short, direct sentences in active voice.
- Name things by what people recognize: "Copies", not "replicas"; "Free up space", not "prune orphan images".
- No marketing phrases, exclamation marks, emoji, or em dashes in interface text.
- Don't repeat the page title in a description. Leave the description out instead.

## Vocabulary

| System term | Interface term |
| --- | --- |
| success (deployment) | Published |
| success (app now) | Live, "Online now". "Live" is only for apps: the live-updates indicator stays hidden while connected and speaks up only when reconnecting or offline |
| queued | Waiting |
| building, starting | Publishing, with the current step |
| failed | Failed (history), "didn't go live" (app) |
| clone · build · start · healthcheck · route | Getting code · Building · Starting · Checking it responds · Switching traffic |
| rollback | Restore this version |
| prune cache, orphan images | Free up space: Clear the build cache, Remove unused images |
| replicas | Copies |
| build limit, cache bytes | Builds at the same time, Build cache size |
| deploy (verb) | Publish |
| users, GitHub App + S3, audit log, platform | Team, Connections, Activity, System |

Technical terms stay available where they help: commit SHAs, the Dockerfile path, `RUN --mount=type=secret`.

## Actions

- A button says exactly what it does: "Publish latest", "Restore this version", "Save 3 changes".
- One primary action per context. The others are outline or ghost buttons.
- After an action, a toast confirms it in the same words: "Publishing api at a1b2c3d."
- Confirm only actions that remove something or take a site offline. The confirmation states the consequence in one sentence: "The app restarts without it."

## Errors and failures

- Say what happened, then what to do: "Your app didn't answer at / on port 8080 within 60 seconds." followed by "Make sure it listens on port 8080 on all interfaces (0.0.0.0), or change the port in Settings."
- Show where it stopped (the step) and the log lines that matter.
- Never show internal errors or stack traces. Services return typed messages; everything else becomes "Something went wrong. Try again."
- Failure explanations live in `web/pages/explain.go`, keyed by the agent's failure code.

## Numbers and time

- Relative times ("5 min ago") with the exact UTC time in a `title`.
- Durations from measured stage timings only. Never show invented percentages.
- Sizes in binary units (MiB, GiB).

## Portuguese

The interface is also available in Brazilian Portuguese. The catalog and its glossary live in `web/i18n/pt_br.go`, the only file where Portuguese text is allowed. Translate meaning, not words; use the glossary's terms everywhere; keep common developer loanwords (build, logs, app, commit, branch, push); address the reader informally; and keep sentences as short as the English.
