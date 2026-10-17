GO ?= go
GOAMD64 ?= v1
BIN := $(CURDIR)/bin
TOOLS := $(CURDIR)/.tools
export CGO_ENABLED := 0
export GOBIN := $(TOOLS)
export GOAMD64

.PHONY: build test test-integration lint proto tools dev dev-seed bench performance clean web web-vendor web-size e2e
build:
	$(GO) build -pgo=auto -trimpath -ldflags='-s -w' -o $(BIN)/nelcota-panel ./cmd/nelcota-panel
	$(GO) build -pgo=auto -trimpath -ldflags='-s -w' -o $(BIN)/nelcota-agent ./cmd/nelcota-agent
test:
	$(GO) test -count=1 -timeout=120s ./...
# Integration tests need a reachable Docker daemon and Caddy; the preflight fails early without them.
test-integration:
	./scripts/check-integration-infra.sh
	$(GO) test -tags=integration -count=1 -timeout=10m ./...
lint:
	@test -z "$$(gofmt -l cmd internal web scripts)" || { echo 'Run go fmt ./...'; exit 1; }
	$(GO) vet ./...
	$(GO) vet -tags=integration ./...
	$(TOOLS)/golangci-lint run
	shellcheck scripts/*.sh
proto:
	PATH="$(TOOLS):$$PATH" protoc -I proto --go_out=. --go_opt=module=github.com/Nelcota/NelcotaDeploy --connect-go_out=. --connect-go_opt=module=github.com/Nelcota/NelcotaDeploy --go-vtproto_out=. --go-vtproto_opt=module=github.com/Nelcota/NelcotaDeploy,features=marshal+unmarshal+size proto/agent/v1/agent.proto
tools:
	$(GO) install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
	$(GO) install connectrpc.com/connect/cmd/protoc-gen-connect-go@v1.19.1
	$(GO) install github.com/planetscale/vtprotobuf/cmd/protoc-gen-go-vtproto@v0.6.0
	$(GO) install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0
	$(GO) install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.11.3
	$(GO) install golang.org/x/perf/cmd/benchstat@v0.0.0-20261009192801-be2c69fb417e
	$(GO) install github.com/a-h/templ/cmd/templ@v0.3.1020
	$(GO) install github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
	./scripts/install-tailwind.sh $(TOOLS)
dev: build
	$(BIN)/nelcota-panel dev
dev-seed:
	$(GO) run ./cmd/nelcota-panel dev-seed
bench:
	@bash -o pipefail -c "$(GO) test -run='^$$' -bench=. -benchmem ./internal/... | tee bench.txt"
performance: build
	./scripts/performance.sh
clean:
	rm -rf bin

.PHONY: sqlc generate check-generated
sqlc:
	$(TOOLS)/sqlc generate
generate: proto sqlc web
check-generated: generate
	git diff --exit-code -- internal/gen internal/store/dbgen web
	@test -z "$$(git status --porcelain -- web)" || { git status --porcelain -- web; echo 'Generated web files are out of date'; exit 1; }

# Frontend: templ components, Tailwind CSS, and fingerprinted precompressed assets.
web:
	$(TOOLS)/templ generate -path web
	$(TOOLS)/tailwindcss --cwd web/static/src -i app.css -o ../build/app.css --minify
	$(GO) run ./web/internal/assetgen -root web/static
# Refresh vendored browser libraries from web/package-lock.json (requires Node).
web-vendor:
	./scripts/web-vendor.sh
web-size:
	$(GO) test -run TestAssetBudget -v ./web/static/
# End-to-end browser tests against `nelcota-panel dev` (requires Node and Playwright browsers).
e2e: build
	cd web && npx playwright test

.PHONY: visual visual-update screenshots report-numbers english lint-workflows
# Visual regression in the Playwright image pinned to web/package.json (requires Docker).
visual: build
	./scripts/visual.sh check
# Regenerate the container baselines in web/e2e/visual.spec.js-snapshots/container/.
visual-update: build
	./scripts/visual.sh update
# Regenerate docs/screenshots in the same pinned container (requires Docker).
screenshots: build
	SCREENSHOTS=1 PLAYWRIGHT_CONTAINER_ENV=SCREENSHOTS ./scripts/playwright-container.sh npx playwright test e2e/screenshots.spec.js
# Rewrite the generated numbers block in docs/status.md (runs the budget tests and Playwright).
report-numbers: build
	./scripts/report-numbers.sh
# English-only repository content (AGENTS.md); also part of `make test`.
english:
	$(GO) test -count=1 ./internal/policy/
# Lint GitHub Actions workflows (actionlint also runs ShellCheck on run: steps).
lint-workflows:
	$(TOOLS)/actionlint
