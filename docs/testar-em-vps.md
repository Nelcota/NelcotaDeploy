# Validação em VPS descartável

## Pré-requisitos

Duas VPS Debian 12+ ou Ubuntu 22.04+, acesso SSH por chave já testado, DNS apontando para os IPs corretos e console de recuperação do provedor. Começar sem Caddy/WireGuard existentes: os scripts recusam sobrescrever essas configurações. A instalação altera firewall, SSH e serviços; realizar o primeiro ensaio numa máquina descartável.

Não há domínio, repositório oficial, chave de assinatura nem release público configurados neste checkout. O mantenedor deve revisar os binários BuildKit oficiais para amd64 e arm64 e executar `scripts/release.sh CHAVE_MINISIGN BUILDKITD_AMD64 BUILDKITD_ARM64`. Publicar os arquivos de `dist/` numa URL HTTPS de versão imutável e distribuir a chave pública minisign por um canal confiável. Os instaladores recusam artefatos sem assinatura válida do checksum.

## Painel

```sh
sudo bash scripts/install.sh panel \
  --domain painel.exemplo.com --email admin@exemplo.com \
  --release-url https://releases.exemplo.com/v0.1.0 \
  --signing-key CHAVE_PUBLICA_MINISIGN
```

Ler `/etc/nelcota/first-access.json` via SSH/root. Contém um convite de registro de passkey válido por 15 minutos; não enviar para logs nem publicar. A interface ainda é placeholder: usar os endpoints e o fluxo de `contrato-frontend.md` para registrar a passkey. O script não imprime o token no terminal compartilhado.

Verificar `systemctl status nelcota-panel wg-quick@wg0 caddy`; confirmar 80/443 públicos e 8443 somente em `10.77.0.1`. `GET /debug/pprof/` e `/metrics` na API pública devem retornar 404. Diagnósticos exigem `NELCOTA_PPROF_LISTEN=10.77.0.1:6060` no arquivo de ambiente e reinício do painel.

Configurar o GitHub App por `POST /api/github/manifest`, submeter o formulário retornado ao GitHub e completar o callback. Instalar o App nos repositórios desejados; usar o installation ID na configuração da app.

## Agent

Gerar convite por `Servers.Invite`/`POST /api/servers/invite`, escolhendo um IP exclusivo em `10.77.0.0/24`. Copiar o token para um arquivo root 0600 na VPS de deploy e executar:

```sh
sudo bash scripts/agent.sh --panel-url https://painel.exemplo.com \
  --join-file /root/nelcota-join \
  --release-url https://releases.exemplo.com/v0.1.0 \
  --signing-key CHAVE_PUBLICA_MINISIGN
sudo rm /root/nelcota-join
```

O bundle assinado precisa incluir `buildkitd_linux_amd64` e `buildkitd_linux_arm64`. O binário Go nunca invoca shell arbitrário: usa apenas o executável Git com argumentos fixos, os clientes Docker/BuildKit e a API Caddy. O instalador é uma operação administrativa explícita em shell.

Verificar `systemctl status nelcota-agent nelcota-buildkit caddy wg-quick@wg0`, `wg show`, `ss -lntup`, `iptables -S DOCKER-USER`, `iptables -S NELCOTA-ISOLATION` e regras IPv6. Repetir após reboot. O painel usa `SaveConfig=true` para conservar os peers adicionados via wgctrl na parada do túnel.

## Aceitação do pipeline

1. Criar app com domínio válido e Dockerfile que rode como UID/GID 65532, escute em porta >1024 e escreva apenas em `/tmp`. O root filesystem é somente leitura. Exemplo de healthcheck: GET `/health` com resposta 200.
2. Fazer push de três SHAs completos em sequência. Os dois antigos ainda queued devem virar cancelled; somente um ativo por app; respeitar o limite do server. GitHub deve receber check run.
3. Publicar uma versão com healthcheck inválido: a rota e a imagem anterior devem continuar funcionando. O container e a imagem da candidata devem ser removidos.
4. Cancelar durante clone/build. Verificar encerramento dos processos e pasta temporária vazia, sem retirar a versão anterior.
5. Durante deploy válido, manter carga com `oha` numa máquina externa e comparar respostas/erros antes, durante e depois. Não declarar zero perda sem esse ensaio; o grace period padrão de retirada é 5 s e precisa de teste com requests longos/streaming.
6. Derrubar a conexão WireGuard, reiniciar painel/agent e matar containers. Confirmar reconexão, reconciliação, reparação de rota, estado cifrado e resolução dos deploys ativos via heartbeat.
7. Aplicar env e domínio enquanto um deploy roda. Confirmar atualização posterior da revisão, ausência de segredo em logs e ausência de portas publicadas em `docker inspect`.
8. Testar réplica 1→2→1, stop/start e exclusão de app já parada. Inspecionar bridges, containers e imagens para resíduos.
9. Abrir SSE com consumidor lento e desconectá-lo; o build deve continuar. Testar logs de runtime, retenção de 50 deploys, restart do painel e leitura zstd.
10. Reutilizar convite, assinatura de webhook, desafio WebAuthn e código TOTP; cada proteção deve recusar o replay conforme seu domínio. Webhooks repetidos com o mesmo delivery ID são idempotentes.

## Testes automatizados e performance

```sh
make tools generate build test lint
CGO_ENABLED=1 go test -race ./...
make test-integration
make bench
scripts/performance.sh --panel-pid PID --agent-pid PID \
  --deployment /tmp/deploy-sanitizado.json --app-kind go \
  --webhook-seconds 0.05 --install-seconds 240 --lost-requests 0 --proxy-ms 0.5
```

Os números do último comando são exemplos de formato, não resultados. Substituir por medições reais; argumentos ausentes aparecem como `pending`. Usar o DTO de um deploy success para extrair tempos por etapa. Medir a RAM em repouso antes de ativar pprof/flight recorder. Arquivos de perfil podem revelar estrutura interna: guardar com permissão 0600 e fora do repositório.

## Recuperação e manutenção ainda manual

Conservar `/etc/nelcota/master.key`, CA, chave de assinatura e banco em backup criptografado separado. Para backup consistente, usar SQLite `VACUUM INTO`/API de backup; copiar apenas o `.db` enquanto WAL está ativo não é backup consistente. Não foi implementado upload S3, restore/uninstall/update administrativos nem rotação automática dos certificados (validade: três meses); estas operações permanecem listadas em `pendencias.md`. Não usar esta primeira versão em produção permanente antes da aceitação acima.
