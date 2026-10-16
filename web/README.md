# Frontend boundary

Reserved for templ, Datastar, and Tailwind. The backend exposes `web.Register(r, services)` as a router extension point. Keep business rules out of handlers; call `internal/service`. See [the frontend contract](../docs/frontend-contract.md).
