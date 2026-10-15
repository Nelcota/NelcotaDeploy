# Nelcota Deploy — backend

Painel e agent self-hosted em Go 1.26, com SQLite, ConnectRPC/mTLS, Docker/BuildKit e Caddy. O frontend está reservado em `web/`; só há uma página placeholder.

```sh
make tools          # geradores, sqlc, golangci-lint e benchstat
make generate
make build test lint
make dev-seed
make dev
```

Requisitos locais: Go 1.26.9+, make, protoc e shellcheck. Para integração: Docker e Caddy. Dependências de frontend não são necessárias. O modo dev escuta apenas em `http://127.0.0.1:8080`, persiste em `.local/dev` e simula agents sem Docker/VPS.

Login de desenvolvimento:

```sh
curl -c /tmp/nelcota-dev-cookies -H 'Origin: http://127.0.0.1:8080' \
  -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8080/api/dev/session
curl -b /tmp/nelcota-dev-cookies http://127.0.0.1:8080/api/session
```

O segundo request retorna o CSRF token usado nos POSTs seguintes. O endpoint dev não existe no modo de produção. Não publicar o processo dev atrás de proxy.

- [Contrato do frontend](docs/contrato-frontend.md): serviços, DTOs, JSON, autenticação e streams.
- [Roteiro de VPS](docs/testar-em-vps.md): instalação assinada em duas VPS, acesso por passkey, deploy sob tráfego, backup/restore, update e rollback, com comandos e critérios de aprovação.
- [Releases de homologação](docs/releases-homologacao.md): v1.0.0, v1.0.1 e v1.0.2 assinados localmente, chave pública, BuildKit recompilado com correções e evidências de validação.
- [Progresso](docs/progresso-backend.md), [decisões](docs/decisoes.md), [pendências](docs/pendencias.md).
- [Operação](docs/operacao-backend.md): memória, backup/restore, S3, update assinado e recuperação de TOTP.
- [Relatório](docs/relatorio-backend.md): estado real, verificações e limites.

Produção: `nelcota-panel init --email ...` inicializa chaves e primeiro convite; `nelcota-panel serve` exige origem HTTPS e interface WireGuard. O agent usa `join` com token em arquivo e depois `serve`. Consultar `--help` e o guia antes de executar os instaladores em VPS descartável.

`make test-integration` falha se Docker/Caddy estiverem ausentes; não converte ausência de infraestrutura em teste aprovado. `make bench` usa `b.Loop()`; `scripts/performance.sh` distingue medições reais de metas ainda pendentes. Não há licença escolhida no plano: decidir antes da distribuição pública.
