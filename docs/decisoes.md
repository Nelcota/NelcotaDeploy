# Decisões

## 2026-10-15 — Documento canônico
Contexto: a solicitação cita `docs/plano.md` e `AGENTS.md`; só existe `docs/Nelcota Deploy.md`.
Escolha: conservar o documento recebido e usá-lo integralmente como plano. Não inventar instruções ausentes.

## 2026-10-15 — Escopo inicial
Escolha: v1 exige Dockerfile; detecção automática fica fora até haver templates auditados. Admin e membro são suportados. `exec` não faz parte do protocolo habilitado. O controle usa ConnectRPC bidirecional em HTTP/2, prevalecendo sobre a menção antiga a WebSocket no roadmap.

## 2026-10-15 — Fronteira de segurança e operação

- Sessões de uma hora; passkey exige user verification. TOTP configurado acrescenta etapa obrigatória antes de emitir sessão. Convites separados para usuários e servers, sem signup público nem senha padrão.
- APIs públicas escutam em loopback atrás do Caddy; o RPC tem listener separado, exige endereço da interface WireGuard e mTLS. `X-Forwarded-For` só é aceito de loopback, assumindo que Caddy sobrescreva cabeçalhos externos.
- Auditoria participa da mesma transação das mutações de domínio. Triggers rejeitam UPDATE/DELETE. Root com acesso ao arquivo continua fora dessa garantia; logs não são vendidos como invioláveis contra o administrador da VPS.
- Swap: intenção cifrada é persistida antes da troca de rota; containers anteriores ficam no journal até remoção. Heartbeat relata versão observada para reparar eventos terminais perdidos. Cache de IDs de comando é persistido para recusar replay após restart.
- Dockerfiles são obrigatórios na v1. O usuário efetivo é sempre UID/GID 65532, com rootfs read-only e `/tmp` limitado. Aplicações que precisam de filesystem gravável adicional precisam de decisão explícita futura; não relaxar o isolamento automaticamente.
- Slots de build são conservadores (1 por padrão); o admin pode escolher 2 para VPS maiores ao criar o convite. Não usar autoajuste sem medição.

## 2026-10-15 — Supply chain e instaladores

Não há projeto oficial/release/chave pública identificados no material recebido. Em vez de inventar uma identidade, os instaladores exigem URL HTTPS de release e chave minisign fornecida por canal confiável. Manifesto SHA-256 é verificado por assinatura antes de instalar qualquer binário. Os buildkitd também entram no bundle assinado; o mantenedor precisa verificar a proveniência antes de assiná-los. GoReleaser está preparado; `scripts/release.sh` empacota e assina localmente sem publicar.

Instaladores recusam sobrescrever Caddy/WireGuard existentes, exigem chave SSH prévia, conservam os dados e não tentam atualizar uma instalação ativa. A validação de sistema real segue no guia de VPS.

## 2026-10-15 — Otimização medida de zstd

Benchmark local em Ryzen 7 9700X, Go 1.26.9 e filesystem `/tmp`: encoder novo por linha custava 29.070 ns/op, 644.586 B/op e 22 allocs/op. Pool de encoders e buffers: 1.437 ns/op, 298 B/op e 5 allocs/op, preservando frames concatenados e teste de round-trip. A mudança só foi feita depois da medição. Isso não comprova latência ou consumo de RAM em VPS.

## Referências técnicas verificadas

- [Connect: protocolo, incluindo exigência de HTTP/2 para bidirecional](https://connectrpc.com/docs/protocol/).
- [Caddy API: PATCH, POST, IDs, persistência e concorrência](https://caddyserver.com/docs/api).
- [Distribuições oficiais do Go](https://go.dev/dl/): Go 1.26.9 baixado com checksum publicado verificado.

## 2026-10-15 — Atualização após análise de vulnerabilidades

A análise inicial com govulncheck v1.9.0 indicou 25 alertas em símbolos de dependências antigas. Atualizados BuildKit para v0.34.0, cliente oficial Moby para o módulo mantido `github.com/moby/moby/client` v0.6.2, API v1.56.1, containerd, gRPC, x/net, OpenTelemetry e dependências associadas. O driver usa `fsutil.FS` no lugar do LocalDirs removido do BuildKit. Não foram adicionadas bibliotecas concorrentes fora do plano; fsutil e containerd/errdefs são dependências das APIs oficiais.

A análise repetida encontrou zero vulnerabilidades em símbolos alcançáveis e zero nos pacotes importados; restou um aviso de módulo requerido sem caminho de chamada. As versões exatas estão em go.mod/go.sum. O instalador usa o repositório apt oficial do Docker com fingerprint fixada; não executa o script remoto get.docker.com. Referências: [Debian](https://docs.docker.com/engine/install/debian/) e [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).

## 2026-10-15 — Robustez de fila, logs e fronteira da UI

- Publicação de check run usa outbox SQLite e worker com retry; chamadas lentas ao GitHub não entram no caminho do heartbeat/logs do agent. Envio usa token de instalação, e criação/atualização de checks têm teste com transporte HTTP simulado.
- Env é patch por chave, com remoção explícita. O frontend consegue atualizar uma variável sem ler nem reenviar segredos existentes. Limite agregado por app evita exceder o limite do protocolo.
- Tokens de API têm escopos verificados nos serviços, validade máxima de 30 dias, hash no banco e revogação. Criar outro token exige sessão interativa recente; bearer não pode ampliar seus escopos emitindo outro token.
- Logs têm ring limitado por quantidade e por bytes (1 MiB por deploy). O transporte reserva uma fila para status/heartbeat; saturação de logs não cancela o build. Streams ao browser são efêmeros e exigem recarregar snapshots após reconexão.
- GC de cache roda em duas políticas: idade de sete dias e teto de tamanho sem restrição de idade. Isso evita conservar cache recente acima do teto por causa de uma única política combinada.

## 2026-10-15 — Gates e escopo operacional

Os oito marcos foram priorizados conforme a solicitação. A aceitação completa do pipeline e dos instaladores exige VPS. Docker estava indisponível inicialmente e tornou-se disponível no fim; a integração real foi então executada e passou. O plano mistura serviços operacionais (backup remoto/restore/update e jobs de imagens base) com o núcleo da fase 1; eles ficam explicitamente não implementados nesta entrega, sem endpoints falsos, e estão inventariados em pendências. Esse recorte deve ser revisado pelo mantenedor antes de chamar a versão de produção.

## 2026-10-15 — Integração real adicional

O Docker foi disponibilizado durante o trabalho. Testes passaram com app em bridge, sem port bindings; Caddy de teste usa rede do host com listeners de loopback, reproduzindo o proxy nativo de produção. O BuildKit de teste precisa de privilégio OCI explícito; quando HostConfigModifier é usado no testcontainers, esse atributo deve ser definido no modifier (os defaults legados são substituídos). Apenas o builder de teste é privilegiado; a app é inspecionada como não privilegiada, não-root, cap-drop ALL, readonly, com CPU/RAM e sem publicação de porta. O teste verifica tráfego real no proxy durante a troca e limpeza das imagens/containers anteriores.
