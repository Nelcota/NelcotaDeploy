GO ?= go
GOAMD64 ?= v1
BIN := $(CURDIR)/bin
TOOLS := $(CURDIR)/.tools
export CGO_ENABLED := 0
export GOBIN := $(TOOLS)
export GOAMD64

.PHONY: build test test-integration lint proto tools dev dev-seed bench performance clean
build:
	$(GO) build -pgo=auto -trimpath -ldflags='-s -w' -o $(BIN)/nelcota-panel ./cmd/nelcota-panel
	$(GO) build -pgo=auto -trimpath -ldflags='-s -w' -o $(BIN)/nelcota-agent ./cmd/nelcota-agent
test:
	$(GO) test -count=1 -timeout=120s ./...
test-integration:
	$(GO) test -tags=integration -count=1 -timeout=10m ./...
lint:
	@test -z "$$($(GO) fmt ./...)" || { echo 'Execute go fmt ./...'; exit 1; }
	$(GO) vet ./...
	$(TOOLS)/golangci-lint run
	shellcheck scripts/*.sh
proto:
	PATH="$(TOOLS):$$PATH" protoc -I proto --go_out=. --go_opt=module=github.com/nelcota/nelcota-deploy --connect-go_out=. --connect-go_opt=module=github.com/nelcota/nelcota-deploy --go-vtproto_out=. --go-vtproto_opt=module=github.com/nelcota/nelcota-deploy,features=marshal+unmarshal+size proto/agent/v1/agent.proto
tools:
	$(GO) install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
	$(GO) install connectrpc.com/connect/cmd/protoc-gen-connect-go@v1.19.1
	$(GO) install github.com/planetscale/vtprotobuf/cmd/protoc-gen-go-vtproto@v0.6.0
	$(GO) install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0
	$(GO) install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.11.3
dev: build
	$(BIN)/nelcota-panel dev
dev-seed:
	$(GO) run ./cmd/nelcota-panel dev-seed
bench:
	$(GO) test -run='^$$' -bench=. -benchmem ./internal/... | tee bench.txt
performance: build
	./scripts/performance.sh
clean:
	rm -rf bin
