# Contributing to NelcotaDeploy

The project is under development. The backend and web interface are implemented; VPS acceptance testing is the next milestone. See [status](docs/status.md).

## Language

Use **English** for documentation, comments, UI and CLI text, filenames, commit messages, issue reports, pull request titles and descriptions, and release notes. This applies even when a conversation with the maintainer uses another language. See [AGENTS.md](AGENTS.md).

## Set up development

Use Linux, Go 1.26.9+, Git, Make, protoc 36.1, and ShellCheck. Install Docker and Caddy for integration testing. The race detector requires CGO and a C compiler. Use the pinned protoc version so generated-file metadata matches CI.

```bash
make tools
make generate
make build test lint
make dev-seed
make dev
```

Development mode uses local data in `.local/dev`, simulated agents, and its own development session. See the [README](README.md#local-development) for API examples.

Interface changes: follow the [writing guide](docs/ui-writing.md); edit `.templ` files, `web/static/src`, or vendored libraries (`make web-vendor`), then run `make web` and commit the generated `*_templ.go` files and `web/static/dist`. Run `make e2e` for browser tests; it needs Node and Playwright's Chromium (`cd web && npm ci && npx playwright install chromium`).

## Propose a change

1. Open an issue before changing architecture or public behavior. Describe the problem and proposed result.
2. Create a branch from `main`; external contributors can use a fork.
3. Keep pull requests focused and update affected documentation.
4. Explain the before/after behavior and record the validation commands you ran.

Treat people respectfully and keep discussions focused on the technical problem.

## Check your change

```bash
make build test lint check-generated
CGO_ENABLED=1 go test -race -count=1 ./...
```

For changes to deployment, containers, routing, or installers, also run `make test-integration` with Docker and Caddy available. Record infrastructure limitations in the pull request. Missing infrastructure is not a passing test.

See [development and release automation](docs/development.md) for every Makefile target and workflow, including `make visual`, `make english`, releases, and automated VPS acceptance.

Add regression tests for behavior fixes. Do not edit `internal/gen/` or `internal/store/dbgen/` manually: change the Protobuf/SQL source and run `make generate`.

## Project boundaries

- HTTP handlers call `internal/service`; services own authorization and business rules.
- Database changes need a new migration. Preserve the compatibility required for executable rollback.
- The agent protocol does not expose remote shell/exec. New actions must retain validation, authorization, and replay protection.
- Do not commit credentials, private keys, databases, backups, logs containing real data, or artifacts from `.local/` and `dist/`.
- Follow [SECURITY.md](SECURITY.md) for security-sensitive changes.

Contributions are provided under the project's [MIT license](LICENSE).
