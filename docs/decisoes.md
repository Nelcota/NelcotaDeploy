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

Os oito marcos foram priorizados conforme a solicitação. A aceitação completa do pipeline e dos instaladores exige VPS. Docker estava indisponível inicialmente e tornou-se disponível no fim; a integração real foi então executada e passou. O plano mistura serviços operacionais (backup remoto/restore/update e jobs de imagens base) com o núcleo da fase 1; eles foram inicialmente separados e depois implementados a pedido do usuário. A continuação abaixo registra o comportamento final. A homologação de infraestrutura continua obrigatória para produção.

## 2026-10-15 — Integração real adicional

O Docker foi disponibilizado durante o trabalho. Testes passaram com app em bridge, sem port bindings; Caddy de teste usa rede do host com listeners de loopback, reproduzindo o proxy nativo de produção. O BuildKit de teste precisa de privilégio OCI explícito; quando HostConfigModifier é usado no testcontainers, esse atributo deve ser definido no modifier (os defaults legados são substituídos). Apenas o builder de teste é privilegiado; a app é inspecionada como não privilegiada, não-root, cap-drop ALL, readonly, com CPU/RAM e sem publicação de porta. O teste verifica tráfego real no proxy durante a troca e limpeza das imagens/containers anteriores.

## 2026-10-15 — Operação e memória após perfil

- O custo de RSS era sobretudo espaço temporário da compilação WASM, não heap vivo. Usamos `debug.FreeOSMemory` uma vez na inicialização; o driver e o pool de consultas permaneceram. Agent aquece os descritores de métricas antes dessa liberação e usa GOGC=50 por padrão, respeitando o ambiente. `GODEBUG=disablethp=1` nos dois serviços evita amplificação por páginas enormes do kernel com heaps pequenos, conforme o [guia Go](https://go.dev/doc/gc-guide#Linux).
- Backup usa VACUUM INTO, tar em stream e AES-GCM em blocos com chave derivada por arquivo e final autenticado. A chave de backup é independente da master e nunca vem no tar; o restore usa a cópia fornecida pelo operador para recriá-la. Restore verifica integridade e decifra os campos antes de substituir arquivos. Lock e marcador durável impedem servir estado parcial.
- S3 usa apenas PutObject path style, HTTPS e SigV4 com payload assinado, na biblioteca padrão. Não adicionamos SDK para essa operação limitada; vetor oficial AWS e upload TLS local cobrem o signer. Configuração pode vir de arquivo 0600 ou de settings cifrados.
- Update só aceita versão estável posterior e manifesto Minisign prehashed ED, inclusive comentário confiável. O helper root tem comando e destino fixos e revalida os downloads. Paths de requests/results ficam confinados com os.Root. O serviço controla ordem, ociosidade, prontidão e confirmação; agente por CLI também reserva manutenção no painel por mTLS antes de pedir instalação.
- Rotação de certificados preserva CA e identidade, guarda o par novo atomicamente em data-dir e oferece sete dias para repetição pelo fingerprint anterior. O par pendente no painel fica cifrado. A CA de cinco anos não muda automaticamente a confiança dos peers.
- Métricas têm no máximo 256 containers por amostra, quatro chamadas concorrentes e dez segundos de orçamento. Bases são parseadas pelo parser Dockerfile oficial, com defaults ARG, sem executar comandos; tags são materializadas no content store do BuildKit e digest pins permanecem imutáveis.


## 2026-10-15 — Interface funcional e revisão completa

A interface foi implementada com `html/template` (alternativa já admitida pelo contrato), CSS local e JavaScript sem framework. A escolha preserva binário único, fronteira de serviços e CSP, com menos de 100 KiB de JavaScript antes da compressão. Node/Playwright são dependências somente de QA. templ/Datastar/Tailwind deixam de ser pré-requisito para usar o painel; eventual migração não deve reintroduzir dependência de CDN ou substituir a autorização dos serviços.

WebAuthn não aceita RP ID de endereço IP: o modo dev usa a origem canônica `http://localhost:8080`, mantendo bind em `127.0.0.1`. O fluxo foi exercitado com autenticador virtual Chromium; dispositivos físicos permanecem um gate externo.

As duas revisões e suas evidências estão em `entrega-revisoes.md`. Previews, notificações externas, scale-to-zero, Trivy e Litestream continuam explicitamente na fase 2 do escopo documentado; não são anunciados por controles que não funcionam. Instalação/reboot/firewall/SSH reais e publicação assinada exigem infraestrutura/identidade do mantenedor, sem credenciais inventadas ou alterações de produção nesta tarefa.
