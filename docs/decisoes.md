# Decisões

## 2026-10-15 — Documento canônico
Contexto: a solicitação cita `docs/plano.md` e `AGENTS.md`; só existe `docs/Nelcota Deploy.md`.
Escolha: conservar o documento recebido e usá-lo integralmente como plano. Não inventar instruções ausentes.

## 2026-10-15 — Escopo inicial
Escolha: v1 exige Dockerfile; detecção automática fica fora até haver templates auditados. Admin e membro são suportados. `exec` não faz parte do protocolo habilitado. O controle usa ConnectRPC bidirecional em HTTP/2, prevalecendo sobre a menção antiga a WebSocket no roadmap.
