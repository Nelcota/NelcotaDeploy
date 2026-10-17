# ADR-0003: Agent jobs outlive control sessions

- **Status:** Proposed
- **Date:** 2026-10-16
- **Findings:** F-01, F-02, F-03, F-04, F-45

## Context

On the agent, `Pipeline.launch` derives each deploy's context from the context passed to `Handle`, which is the control stream's errgroup context (`internal/agent/pipeline.go:264`, `internal/transport/connect.go:242,320`). Commands are handled synchronously in the receive loop, and any handler error ends the session. A reconnect therefore cancels every in-flight build, and a slow reconcile can expire queued commands, which ends the session. Session end reasons are not logged.

## Options

1. **Only derive job contexts from `Pipeline.Run`.** Builds survive, but their event sink is dead after a reconnect and command expiry remains.
2. **Worker queue plus a session-independent event sink.** The receive loop verifies and enqueues; jobs and reconcile run on pipeline-owned goroutines; events are buffered across reconnects.
3. **Make every command asynchronous with acknowledgements in the protocol.** Strongest semantics; requires a protocol change and panel work.

## Decision

Option 2 now, keeping the protocol unchanged:

- Job contexts derive from `Pipeline.Run`.
- Events go to a sink that survives sessions: status and operation results are never dropped (coalesced per deployment), log lines may be dropped under pressure, as today.
- Handler failures are reported as `DeployStatus` or `OperationResult` events; only verification failures end a session, and every session end is logged with its reason.
- Reconcile runs on its own goroutine, triggered by the ticker or a snapshot, never inside the receive loop.
- The HTTP/2 transport sets a read-idle ping timeout.

Option 3 is left for a future protocol version if heartbeat inference proves insufficient.

## Consequences

- A panel restart or network blip no longer fails deployments; the panel's heartbeat repair stays as the backstop.
- New tests: reconnect during a fake-engine deploy, 90-second reconcile with queued commands, capacity rejection without teardown.
- The agent holds a bounded buffer of status events while disconnected; its size is a documented limit.
