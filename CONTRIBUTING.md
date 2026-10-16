# Contribuir com o Nelcota Deploy

O projeto está em desenvolvimento. A interface já está integrada; a homologação em VPS é o próximo gate operacional; o [relatório do backend](docs/relatorio-backend.md) e as [pendências](docs/pendencias.md) mostram o estado atual.

## Preparar o ambiente

Use Linux, Go 1.26.9+, Git, Make, protoc e ShellCheck. Para integração, instale Docker e Caddy. Os testes com race detector precisam de CGO e de um compilador C.

```bash
make tools
make generate
make build test lint
make dev-seed
make dev
```

O modo dev usa dados locais em `.local/dev`, agents simulados e uma sessão própria de desenvolvimento. Consulte o [README](README.md#começar-localmente) para usar a API.

## Propor uma mudança

1. Para mudanças de arquitetura ou comportamento público, abra uma issue descrevendo o problema e a proposta.
2. Crie uma branch a partir de `main`; contribuidores externos podem usar um fork.
3. Mantenha o escopo do pull request claro e atualize a documentação afetada.
4. Descreva o comportamento antes/depois e registre os comandos de validação executados.

Use português ou inglês nas issues e nos pull requests. Trate as pessoas com respeito e concentre a discussão no problema técnico.

## Verificar antes do pull request

```bash
make build test lint check-generated
CGO_ENABLED=1 go test -race -count=1 ./...
```

Quando a mudança afetar deploy, containers, proxy ou instaladores, execute também `make test-integration` com Docker e Caddy disponíveis. Se uma verificação depender de infraestrutura que você não tem, registre essa limitação no pull request. Ausência de infraestrutura não equivale a teste aprovado.

Adicione regressões para correções de comportamento. Não edite manualmente `internal/gen/` ou `internal/store/dbgen/`: altere o Protobuf/SQL de origem e execute `make generate`.

## Fronteiras do projeto

- Handlers HTTP usam os serviços de `internal/service`; autorização e regras de negócio pertencem aos serviços.
- Alterações de banco exigem uma migração nova; preserve a compatibilidade necessária ao rollback de executáveis.
- O protocolo do agent não oferece shell/exec remoto. Novas ações precisam manter validação, autorização e proteção contra replay.
- Não envie credenciais, chaves privadas, bancos, backups, logs com dados reais ou artefatos de `.local/` e `dist/`.
- Alterações de segurança devem considerar [SECURITY.md](SECURITY.md).

Ao contribuir, você concorda em disponibilizar sua contribuição sob a [licença MIT](LICENSE) do projeto.


## Interface e QA de navegador

Os assets de `web/assets` são embutidos automaticamente por Go; não há bundler nem dependências JavaScript de produção. Use Node 24, `npm ci` e `npx playwright install --with-deps chromium` para QA; execute `make check-web test-browser` com a porta 8080 livre. A suíte usa banco temporário e autenticador WebAuthn virtual e encerra seus próprios processos. `BROWSER_EXECUTABLE_PATH` permite usar um Chromium já instalado. O CI tem um job separado para esses fluxos.

`make tools` instala protoc 36.1 com checksum publicado verificado. `make check-generated` trabalha em uma cópia temporária dos arquivos atuais, incluindo arquivos novos, e não confunde alterações legítimas não commitadas com geração divergente. Não edite manualmente `dbgen` ou Protobuf.
