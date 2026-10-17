# ADR-0002: Keep a modular monolith; use ports only at external boundaries

- **Status:** Proposed
- **Date:** 2026-10-16
- **Findings:** F-16, F-17, F-19

## Context

The panel and the agent are separate binaries split along a real trust boundary. Inside the panel, `internal/service` (about 6,000 lines) holds business rules and authorization, but it also imports SMTP, SSH, WireGuard, GitHub, and transport types directly. The problems found in the audit are boundary and lifecycle problems inside this structure, not limits of the structure. The comparison of alternatives is in [target state](../target-state.md#d-architecture-comparison).

## Options

1. **Keep as is.** No cost; infrastructure keeps spreading into business code.
2. **Full hexagonal or clean architecture.** Every layer gets ports and mapped types; high cost; wraps sqlc in a redundant repository layer.
3. **Modular monolith with ports only at external boundaries.** Interfaces for agent dispatch, GitHub, mail, webhooks, SSH, WireGuard, object storage, and container runtime; sqlc stays the data layer; `Core.mutate` stays the transaction boundary.
4. **Split `internal/service` into feature sub-packages now.** Clearer ownership; blocked today by the shared `Core` and transaction helper, and risky before the safety-net tests exist.

## Decision

Option 3. Interfaces are declared in `internal/service/ports.go` by the consumer and implemented in `internal/integration/*`, `internal/agent/runtime`, and `internal/maintenance`. `service.New(Deps)` replaces post-construction field assignment. Feature sub-packages (option 4) are reconsidered after roadmap stage S6, one feature at a time, only where the feature has no shared state.

## Consequences

- `internal/service` tests use fakes for every external system.
- Adapters keep their current tests (local HTTP and SMTP servers, simulated GitHub transport) in their new packages.
- Compliance is checked by the dependency test in [ADR-0007](0007-enforce-package-dependency-rules.md).
