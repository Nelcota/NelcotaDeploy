# Releases locais de homologação — 15/10/2026

Os releases **v1.0.0, v1.0.1 e v1.0.2** estão preparados em `dist/`, com assinaturas Minisign e validação local. Nenhum artefato foi publicado e nenhuma VPS foi acessada.

Todos usam o commit Nelcota `dba1c3ba0a7cdebd50ba76d9cd4eab5ddcd5ee15`, compilado com Go 1.26.9, CGO desabilitado e checkout limpo. A diferença entre essas três versões é o número embutido nos executáveis; elas servem para homologar a sequência de atualizações e o rollback. A assinatura é de uma identidade local exclusiva de homologação.

## Entrega

| Arquivo em `dist/` | Tamanho | SHA-256 |
|---|---:|---|
| `nelcota-deploy-v1.0.0-linux.tar.gz` | 81.283.948 bytes | `4298f442a33401e1493da93c973ef6f0066ca04267bfd021c580be4eb5273d04` |
| `nelcota-deploy-v1.0.1-linux.tar.gz` | 81.284.044 bytes | `bd4470efefcca492279c0c7ca87d9c3f739d652eb934ff2b6615904ec956852c` |
| `nelcota-deploy-v1.0.2-linux.tar.gz` | 81.283.929 bytes | `6509950273289d498ef0211553da0554af51b774db76e7ce87372aa4bd589aa7` |

Cada pacote tem uma assinatura `.tar.gz.minisig`. Há também os diretórios descompactados `dist/v1.0.0/`, `dist/v1.0.1/` e `dist/v1.0.2/`, com os nomes esperados pelos instaladores e pelo updater.

Cada diretório contém 16 arquivos:

- Painel e agent para `linux_amd64_v1`, `linux_amd64_v3` e `linux_arm64`: seis executáveis.
- `buildkitd_linux_amd64` e `buildkitd_linux_arm64`: dois daemons.
- `release.json`, `build-info.json`, `buildkit-build-info.txt`, `buildkit-provenance.json`, `buildkit-security.patch` e `buildkit-LICENSE.txt`: metadados, inventário, alteração das dependências e licença.
- `checksums.txt` e `checksums.txt.minisig`: manifesto SHA-256 de todos os 14 arquivos de payload e sua assinatura.

`dist/evidencias-homologacao.tar.gz` reúne logs, validadores e proveniência upstream. `dist/VALIDACAO.md` é a cópia deste relatório. `dist/SHA256SUMS` e sua assinatura cobrem a entrega, incluindo os pacotes, as assinaturas, a chave pública, o relatório e as evidências.

## Identidade de assinatura

Chave pública entregue em `dist/homologacao.minisign.pub`:

```text
RWTogK7s/y7BIqc7dw0qfzxK9pNTCSGUyYHc0/K3heUXXWK90ulX52K6
```

- ID Minisign: `22C12EFFECAE80E8`.
- SHA-256 do arquivo público: `8463daf3dc1a4b959ea81ad69ebe98cdde64bc93aa07be8ee818caad65bb39a6`.
- Chave privada: `/home/haniel/.config/nelcota-release-homologacao/minisign.key`, fora do repositório e dos pacotes. Diretório `0700`, arquivo `0600`.
- Essa chave foi gerada sem senha para assinatura autônoma neste laboratório; sua proteção local depende dessas permissões. Preserve-a para os próximos releases deste laboratório. A identidade de produção continua sendo uma decisão separada.

A chave pública precisa ser conferida por um canal confiável ao transportar os pacotes. Não use apenas a cópia recebida junto com um download sem conferir o fingerprint acima.

## BuildKit recompilado com correções

O [release oficial v0.34.0](https://github.com/moby/buildkit/releases/tag/v0.34.0) foi obtido e seus dois arquivos originais passaram pela conferência de SHA-256 e pela verificação de proveniência Sigstore com `gh attestation verify`. A política verificou repositório, tag, commit de origem, workflow de assinatura, digest desse workflow e uso de runner hospedado no GitHub.

| Arquivo upstream | SHA-256 |
|---|---|
| `buildkit-v0.34.0.linux-amd64.tar.gz` | `14813b1fb2a40082114e6d386c6fc5e7dd5298176ce7ee1a18bc33e73e109ac3` |
| `buildkit-v0.34.0.linux-arm64.tar.gz` | `0619ca3e3205a32ea2beb115e0242136e4a0716cc1917ba0ceaa4ef4d52382c9` |

A análise desses binários encontrou 12 alertas de versão: o upstream foi compilado com Go 1.26.8, `x/net` 0.59.0 e `go-archive` 0.2.0. Entre os problemas estão falhas HTTP/2 corrigidas em Go 1.26.9 e `x/net` 0.60.0, e extração de tar corrigida em `go-archive` 0.3.0. Referências: [GO-2026-6617](https://pkg.go.dev/vuln/GO-2026-6617), [GO-2026-6253](https://pkg.go.dev/vuln/GO-2026-6253). O log integral dos alertas originais está nas evidências.

Os binários oficiais originais foram excluídos da entrega final. Foi feita uma recompilação local a partir do commit upstream atestado `f5b59a1f2fb25a0cb7072c398cab9aed7835da4e`, com:

- Versão própria `v0.34.0-nelcota-hml.1`.
- Go 1.26.9, `golang.org/x/net` 0.61.0 e `github.com/moby/go-archive` 0.3.0, além das atualizações transitivas registradas no patch.
- CGO desabilitado; tags `osusergo,netgo,static_build,seccomp`, iguais às identificadas nos daemons upstream.
- `-trimpath`, `-buildvcs=false` e commit/patch explicitamente registrados na proveniência assinada. Não há alterações no código Go upstream; o patch muda `go.mod` e `go.sum`.

| Daemon final, igual nos três releases | SHA-256 |
|---|---|
| `buildkitd_linux_amd64` | `4f52e57ee50d7c3d28c3e295a7c53934515210e4c1dbb1f74b073df7bac90dac` |
| `buildkitd_linux_arm64` | `1d3d83aaa140e7792f2a16500bca0cdc3c6cf6f09ead5ed57c8a7f1d59053ca4` |

As assinaturas upstream comprovam os arquivos upstream e a origem usada como referência. Os daemons recompilados são assinados pela identidade Nelcota de homologação e identificados como tal. Os SBOMs upstream nas evidências descrevem os arquivos originais; o inventário dos daemons finais está em `buildkit-build-info.txt`.

## Validação executada

| Verificação | Resultado local |
|---|---|
| Testes unitários, vet, golangci-lint, shellcheck e código gerado | Aprovados: `make test lint check-generated` |
| Assinaturas e SHA-256 | Manifestos verificados pelo updater Go e pelo Minisign; pacotes e manifestos também verificados por Minisign 0.11 em Debian, independente do assinador 0.12 |
| Conteúdo dos pacotes | Exatamente 16 arquivos por versão, sem links ou arquivos extras; caminhos, permissões e hashes conferidos contra os diretórios assinados |
| Arquitetura e compilação | 18 binários Nelcota e seis cópias BuildKit; ELF estático, arquiteturas, CGO, versões, dependências e metadados conferidos |
| amd64 v1/v3 | Comando `version` executado nos 12 binários Nelcota; BuildKit amd64 executado nas três versões |
| Debian 12 e Ubuntu 22.04 | Versões executadas em containers locais, sem rede, com arquivos somente leitura |
| arm64 | `version` e `--help` nos seis binários Nelcota e `--version` nos três BuildKit, sob QEMU 7.2.22 |
| Deploy Docker/BuildKit/Caddy | Teste real com o daemon final e o agent final de cada release: build, healthcheck, rotas, isolamento de container, métricas e troca sob tráfego sem perda no teste; candidato com healthcheck ruim preservou a aplicação anterior |
| Backup/restore | Cada painel final executou backup pela API, recusou restore com serviço ativo, restaurou offline e fez novo backup |
| Compatibilidade do backup | Backup v1.0.0 restaurado em v1.0.1 e v1.0.2; chave mestra preservada, `PRAGMA integrity_check` aprovado e novo backup criado |
| Update/rollback | TLS exclusivamente local, arquivos reais, painel e agent em amd64 v1/v3: v1.0.0 → v1.0.1 → v1.0.2; falha de prontidão restaurou bytes, versão e estado anteriores; nova tentativa aprovada |
| Recusas do updater | Assinatura, manifesto, metadados e binário adulterados, chave errada, redirecionamento, replay e downgrade recusados |
| Receita de release | Recusa de sobrescrever versão existente e de versão fora do formato suportado conferidas |
| Vulnerabilidades | Análise do código Nelcota e do BuildKit final em amd64/arm64: zero vulnerabilidades alcançáveis e zero pacotes importados vulneráveis. Os 24 binários finais foram analisados; único alerta restante descrito abaixo |

O único alerta remanescente é [GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932), referente a `golang.org/x/crypto/openpgp`, que não é importado pelo código analisado. Os binários usam `-s -w`; nessa configuração o govulncheck 1.9.0 pode trabalhar com precisão de módulos e reportar esse alerta sem comprovar presença do pacote. Essa limitação consta na [documentação do govulncheck](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck#hdr-Limitations). Os resultados completos, incluindo esse alerta, foram preservados; ele não foi silenciosamente removido dos logs.

Os testes de integração usaram um overlay Go somente local para selecionar os executáveis de release e uma imagem de teste contendo o BuildKit final. O hash de `/usr/bin/buildkitd` dessa imagem foi conferido contra o arquivo entregue. O overlay e seus fontes estão nas evidências; os arquivos de teste versionados permaneceram intactos.

A emulação arm64 foi executada com `GOMAXPROCS=1 GODEBUG=asyncpreemptoff=1`: o QEMU 7.2 apresentou travamentos intermitentes na inicialização do BuildKit com mais CPUs emuladas. Isso limita a evidência à execução desses comandos sob emulação; não substitui deploy em hardware arm64.

## Conferir a entrega sem instalar

Na raiz do projeto, com Minisign no PATH (a cópia local está em `.tools/minisign`):

```bash
set -euo pipefail
export PATH="$PWD/.tools:$PATH"
printf '%s\n' '8463daf3dc1a4b959ea81ad69ebe98cdde64bc93aa07be8ee818caad65bb39a6  dist/homologacao.minisign.pub' | sha256sum -c -
minisign -Vm dist/SHA256SUMS -p dist/homologacao.minisign.pub
(cd dist && sha256sum -c SHA256SUMS)
for version in v1.0.0 v1.0.1 v1.0.2; do
  minisign -Vm "dist/nelcota-deploy-$version-linux.tar.gz" -p dist/homologacao.minisign.pub
  minisign -Vm "dist/$version/checksums.txt" -p dist/homologacao.minisign.pub
  (cd "dist/$version" && sha256sum -c checksums.txt)
done
```

Quando a etapa de VPS for autorizada, o [roteiro de instalação e homologação](testar-em-vps.md) pode usar estes diretórios já preparados:

```bash
HML_RELEASE_DIR="$PWD/dist"
SIGNING_PUBLIC="$PWD/dist/homologacao.minisign.pub"
SIGNING_KEY=$(sed -n '2p' "$SIGNING_PUBLIC")
```

Não regenere a chave nem execute novamente o empacotamento sobre os releases existentes. Os instaladores ainda precisarão de uma URL HTTPS de distribuição, a ser configurada na etapa futura. A troca do BuildKit é administrada separadamente; o updater do painel/agent não substitui esse daemon.

## Reproduzir a compilação

Em checkout limpo, com Go 1.26.9, Minisign e govulncheck 1.9.0 no PATH, use diretórios novos e a chave de homologação já existente:

```bash
bash scripts/buildkit-homologacao.sh .local/buildkit-homologacao-novo
for version in v1.0.0 v1.0.1 v1.0.2; do
  bash scripts/release.sh "$version" \
    "$HOME/.config/nelcota-release-homologacao/minisign.key" \
    "$PWD/.local/buildkit-homologacao-novo/amd64/buildkitd" \
    "$PWD/.local/buildkit-homologacao-novo/arm64/buildkitd" \
    "$PWD/.local/buildkit-homologacao-novo"
done
```

Esse comando de release recusa destinos existentes. Para reproduzir exatamente o código desta entrega, use um checkout separado do commit `dba1c3ba0a7cdebd50ba76d9cd4eab5ddcd5ee15`; alterações posteriores de documentação não mudam o commit registrado nos pacotes. Os validadores locais usados estão em `.local/release-validation/` e no arquivo de evidências. `go run ./.local/release-validation` valida os manifestos e o ciclo de update/rollback usando somente um servidor TLS de loopback.

## Limites da homologação local

A instalação root em Debian/Ubuntu com systemd, WireGuard, TLS público, DNS, acesso externo, reinício de máquina e recuperação após queda de energia continua sendo uma etapa de VPS/VM. Deploy completo em arm64 também depende desse ambiente. A assinatura e os testes locais não representam a execução dessas etapas. Nenhuma publicação, tag remota ou conexão SSH foi feita nesta preparação.
