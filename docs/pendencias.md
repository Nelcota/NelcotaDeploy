# Pendências e validações externas

- Docker/BuildKit/Caddy reais: **resolvido nesta sessão**. O daemon ficou disponível e `make test-integration` passou; ver atualização abaixo.
- VPS Debian/Ubuntu, domínio, WireGuard real e GitHub App de produção exigem recursos externos.
- Publicação, assinatura de releases e identidade do mantenedor dependem de configuração do repositório oficial.

## Resultado confirmado em 2026-10-15

Na primeira tentativa, `make test-integration` compilou a suíte e falhou no pré-requisito: `Cannot connect to the Docker daemon at unix:///var/run/docker.sock`. Nenhum teste foi pulado. A suíte usa testcontainers para BuildKit privilegiado, Caddy, build de imagem, rede e inspeção de hardening. Cgroups/systemd, firewall/WireGuard, TLS público e instalação Debian/Ubuntu ainda precisam de VPS descartável. O host é CachyOS e `sudo` está indisponível por `NoNewPrivileges`.

## O que ainda precisa de aceitação real

- GitHub App criado/instalado e webhook entregue em domínio público. JWT, token de instalação e check runs são cobertos com transporte HTTP simulado; provar também no GitHub real.
- Passkeys em browsers/dispositivos reais. Registro/login ECDSA, origem inválida, replay de cerimônia e TOTP foram testados com autenticador virtual e SQLite reais.
- Releases oficiais assinados, chave pública distribuída e executáveis buildkitd auditados, necessários para executar os instaladores.
- Instalação/reboot Debian/Ubuntu, firewall IPv4/IPv6 e DOCKER-USER, cgroups CPU/IO/RAM, WireGuard real e persistência de peers.
- Homologação de produção: cancelamento de processos reais de Git/build, falta de espaço, crash durante swap e carga representativa com requests longos/streaming. BuildKit/Docker/Caddy, bridge da app, saúde, troca de upstream com tráfego e remoção de imagem/container antigos passaram em integração real local.
- Todas as metas de performance em VPS representativa, incluindo RAM do agent, builds Go/Node com cache e zero requests perdidos. RSS do painel dev: 42,8 MiB em repouso inicial e 125,3 MiB após uso; ainda falta demonstrar retorno ao alvo depois do aquecimento.

## Operação além dos oito marcos

Ainda não foram implementados: backup diário/S3 e CLI de restore/uninstall/update; rotação automática de certificados (validade de três meses); recuperação/reset de TOTP e recovery codes; atualização semanal automática de imagens base; ajuste posterior dos limites/cache do server pela API; telemetria por container. Não há rotas placeholder que anunciem essas operações como disponíveis. Previews, notificações externas, scale-to-zero, Trivy e Litestream continuam na fase 2.

O flight recorder é opcional junto ao listener de diagnóstico e permite snapshot manual; ainda não existe disparo automático ao detectar deploy lento. PGO está habilitado em auto, sem perfil artificial: coletar um perfil representativo antes de versionar `default.pgo`.

## Aviso de módulo da análise de vulnerabilidades

Govulncheck v1.9.0, após atualização das dependências: zero vulnerabilidades em símbolos chamados e em pacotes importados. Um aviso de módulo requerido permanece: GO-2026-5932 (`golang.org/x/crypto/openpgp`, obsoleto). O backend não importa nem usa OpenPGP. Manter o scanner no CI e verificar as versões dos daemons Docker/BuildKit/Caddy distribuídos separadamente.

## Atualização: Docker e containers disponíveis

A limitação inicial do Docker foi resolvida durante a sessão. A suíte completa passou com Docker real, BuildKit v0.34.0 e Caddy v2.10.2. O teste usa o proxy na rede do host e as apps em bridge própria sem portas publicadas; a API BuildKit de teste fica somente em loopback. Foram verificados healthcheck inválido preservando versão anterior, swap sob carga local sem requests perdidos e remoção de imagem/container anteriores. A sintaxe de todos os scripts passou em Debian 12 e Ubuntu 22.04. Isso não substitui executar os instaladores com serviços systemd, firewall e WireGuard numa VPS descartável.
