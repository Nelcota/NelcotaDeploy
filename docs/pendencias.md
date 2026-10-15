# Pendências e validações externas

- Docker/BuildKit/Caddy reais: Docker não estava disponível no ambiente inicial; executar `make test-integration` em host com Docker.
- VPS Debian/Ubuntu, domínio, WireGuard real e GitHub App de produção exigem recursos externos.
- Publicação, assinatura de releases e identidade do mantenedor dependem de configuração do repositório oficial.

## Resultado confirmado em 2026-10-15

`make test-integration` compilou a suíte e falhou no pré-requisito: `Cannot connect to the Docker daemon at unix:///var/run/docker.sock`. Nenhum teste foi pulado. A suíte usa testcontainers para BuildKit privilegiado, Caddy, build de imagem, rede e inspeção de hardening. Cgroups/systemd, firewall/WireGuard, TLS público e instalação Debian/Ubuntu ainda precisam de VPS descartável. O host é CachyOS e `sudo` está indisponível por `NoNewPrivileges`.
