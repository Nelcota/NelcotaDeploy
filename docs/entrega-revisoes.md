# Entrega e duas jornadas de revisão — 2026-10-15

## Resultado e escopo

O fluxo local da v1 está implementado e integrado: painel web, serviços Go, SQLite, autenticação, APIs, eventos e agent. A execução incluiu implementação, uma primeira revisão, uma segunda revisão a partir do estado alterado e validação final. Não houve alteração de produção, publicação de release ou uso de credenciais inventadas.

O escopo segue as decisões existentes: Dockerfile obrigatório, papéis globais admin/member, protocolo fechado sem shell remoto, e funcionalidades explicitamente futuras mantidas na fase 2. Instalação/reboot em VPS, identidade de releases, credenciais reais de GitHub/S3 e dispositivos físicos são gates externos. O resultado não é uma certificação de produção nem uma afirmação de ausência absoluta de bugs.

## 1. Funcionalidades concluídas

- Painel autenticado com dashboard, aplicações, histórico de deploys, logs de build/runtime, configurações, servidores, ajustes e segurança da conta.
- Criação/configuração/exclusão de apps; repositório, branch, domínios, Dockerfile, saúde, CPU/RAM, réplicas, cache e instalação GitHub.
- Deploy por SHA, build limpo, cancelamento e rollback por reconstrução. Estado e tempos por etapa vêm do backend.
- Variáveis por chave sem leitura dos valores anteriores, separação runtime/build e remoção confirmada.
- Servidores com convite de uso único, telemetria, limites de concorrência/cache e limpeza confirmada.
- Usuários e convites, tokens com escopos, ajustes cifrados, GitHub Manifest/callback, backup, atualização, cancelamento de lote e auditoria.
- Cadastro/login WebAuthn, segundo fator TOTP, códigos de recuperação, reset e logout. O login simulado continua restrito ao modo dev e aos dados de teste.
- Logs com busca, pausa, download, buffers limitados e recuperação de conexão; operações administrativas são acompanhadas sem recarregar formulários.
- Tema claro/escuro, navegação por teclado e layout móvel. JavaScript/CSS locais, embutidos, versionados por hash e comprimidos; nenhuma dependência frontend de produção ou CDN.
- Exclusão com outbox durável para logs; falhas de filesystem/reinícios preservam trabalhos de limpeza.
- Infraestrutura de QA com Playwright, Chromium virtual WebAuthn, lockfile npm e job de navegador no CI.

## 2. Bugs e inconsistências corrigidos

| Problema | Correção / regressão |
| --- | --- |
| Passkeys falhavam no dev com RP ID de IP | Origem canônica `localhost`, bind continua em loopback; cadastro/login executados em Chromium |
| Cookie expirado impedia novo login por CSRF | CSRF de cookie válido continua obrigatório; cookie inválido não bloqueia cerimônia de nova autenticação, mantendo a verificação de Origin |
| Cancelamento perdia uma claim concorrente | Leitura e decisão no escritor transacional; teste força a operação a esperar enquanto o deploy passa a building |
| Exclusão aceitava estado parado lido antes de um start concorrente | Configuração e fila verificadas dentro da transação; teste reproduz mudança enquanto o escritor está ocupado |
| Evento terminal concorrente regredia success para failed | Transição revalidada no escritor; teste determinístico de sucesso já commitado |
| Ações de app sobrescreviam configuração concorrente | Atualizações parciais com json_set e auditoria na mesma transação |
| Restart mudava revisão e provocava recriação adicional | Somente o comando de restart; rejeição em app parada; teste verifica revisão e quantidade de comandos |
| Webhook enfileirado ficava invisível na UI enquanto o server estava offline | Publicação de deploy.queued após commit, sem duplicação em delivery repetida; seleção das apps ocorre na mesma transação |
| Logs órfãos após exclusão | Outbox persistida junto da exclusão, worker por lotes e serialização com eventos atrasados; teste com erro real de unlink e retry |
| Healthcheck local passava pelo proxy externo | Transporte direto para a bridge, sem seguir redirects; teste garante que o proxy não recebe requisições |
| Containers Testcontainers sem rota/trust de rede | Encaminhamento de proxy, hosts resolvidos pelo runner e CA, mantendo verificação TLS |
| Clone perdia proxy/CA ao isolar o ambiente Git | Lista permitida de variáveis de rede/trust, sem herdar hooks, tracing, configurações arbitrárias ou bypass de TLS |
| Resposta lenta de configuração trocava uma aba mais nova | Controle de geração da view e dos históricos; navegador atrasa a resposta e verifica a aba selecionada |
| Navegação rápida esgotava o orçamento de API com assets/páginas | Limitação preservada nas APIs; assets públicos imutáveis não consultam sessões |
| UI presa após 429/SSE ou histórico do navegador | Backoff de conexão, recuperação de snapshot/sessão e recarga de páginas restauradas pelo bfcache |
| Protobuf dependia da versão apt da máquina / check comparava com HEAD | protoc 36.1 com checksum fixado; geração em scratch comparada aos arquivos atuais, incluindo novos arquivos |
| Teste de permissões dependia do umask | Fixture torna o arquivo explicitamente público antes de exigir sua rejeição |

## 3. Segurança

- Autorização permanece nos serviços, incluindo a nova visão agregada e streams globais. Um token logs:read sozinho não recebe dados de apps/servers/deployments.
- A UI usa textContent/propriedades DOM para dados externos e html/template para o shell; a regressão de navegador usa mensagem HTML maliciosa e confirma que nenhum elemento executável é criado.
- CSP restringe scripts/estilos à origem, bloqueia objetos/frames e limita formulários externos ao GitHub. Destinos GitHub são validados antes de submissão/redirecionamento.
- MIME JSON é interpretado estritamente, corpos acima de 1 MiB recebem 413 e dados adicionais continuam rejeitados.
- Segredos sobrepostos são mascarados do maior para o menor, evitando sufixos expostos. Journal de replay usa leitura privada, limitada e sem symlink; IDs de comando têm tamanho limitado.
- Sessões/CSRF, convites, otpauth e tokens não são gravados no storage do browser; somente o tema é persistido. Diálogos/campos sensíveis são limpos na navegação.
- Cache GitHub tem limite e é invalidado na rotação de identidade; emissão de token tem timeout. Regressão verifica reutilização e invalidação.
- Assinaturas Minisign, checksums, TLS e isolamento dos containers foram preservados. Não foram habilitados shell remoto, credenciais padrão ou bypasses de verificação.

## 4. Performance

- Dashboard obtém últimos deploys em consulta indexada e usa um endpoint agregado, sem N+1 de requisições por card.
- Telemetria valida até 256 containers em uma consulta de ownership, mantendo a rejeição de métricas de outro server.
- Transportes GitHub reutilizam o token de instalação até expiração; dois check runs precisam de uma emissão em vez de duas no teste HTTP.
- Assets são pré-comprimidos uma vez, com cache immutable, negociação gzip e ETags separados por representação. O JS final possui 53.366 bytes sem compressão e 18.084 bytes com gzip; o roundtrip foi conferido no painel em execução.
- Buffer visível e buffer durante a leitura de logs são limitados a 256 KiB cada. Streams, timers e URLs de download são encerrados/liberados.
- Poll de operações consulta somente operações enquanto há trabalho pendente, com uma requisição em voo e sem apagar formulários.
- Limites de servidor retornam somente o server alterado; não recarregam toda a lista.

Benchmarks locais executados com Go 1.26.9, GOMAXPROCS=4 e `-benchtime=100ms`, em Intel Xeon Platinum 8573C. São medições da máquina de desenvolvimento, sem comparação estatística com outra VPS:

| Benchmark | ns/op | B/op | allocs/op |
| --- | ---: | ---: | ---: |
| Hub | 93,34 | 8 | 1 |
| Ring | 19,94 | 0 | 0 |
| LogStore zstd | 3.850 | 298 | 5 |
| Vault AES-GCM | 197,1 | 96 | 4 |
| Fila SQLite | 359.368 | 8.363 | 176 |

## 5. Chamadas e operações redundantes eliminadas

- Emissão de token de instalação repetida para cada check run.
- Consulta de app por container de uma amostra de métricas.
- Requisição de histórico por aplicação no dashboard.
- Lookup de sessão em cada asset imutável.
- Restart seguido de um segundo rolling restart por mudança artificial de revisão.
- Recarga dos cinco recursos de Ajustes para atualizar/cancelar um backup ou revogar um token.
- Reconsulta imediata de histórico que duplicava o evento de cancelamento já assinado pela tela.
- Operações de UI fora de ordem descartadas; polling encerrado sem jobs e reconexões com backoff.

## 6. Primeira jornada de revisão

Releitura dos serviços, autenticação/tokens/recovery, SQL e migrações, transporte, pipeline/Docker, criptografia, backup/update, scripts e fronteira da UI. Foram examinados autorização por domínio, transações, streams, tratamento de erro, bloqueios, limites de alocação e chamadas externas.

Achados principais: corrida de cancelamento, exclusão e estados terminais; escopos de streams; redator com prefixos; journal de replay; N+1 de telemetria; tokens GitHub sem reutilização; concorrência de respostas da UI. Os testes determinísticos bloqueiam o escritor para reproduzir os interleavings, sem converter ausência de infraestrutura em aprovação.

Após as correções: build, suíte Go, vet/lint/ShellCheck, geração reproduzível, navegador e race detector passaram. O scanner de vulnerabilidades foi executado com a base oficial obtida pelo GitHub.

## 7. Segunda jornada de revisão

Nova passagem a partir da arquitetura e do diff final, acompanhando fluxos alternativos: ação concorrente com edição, restart de app parada, exclusão com I/O falhando e eventos atrasados, reconnect/429, restauração de histórico, troca rápida de aba, expansão de buffers e rotação de credenciais.

Achados adicionais corrigidos: ações com read-modify-write, restart duplicado, logs órfãos, evento de webhook ausente, propagação incompleta de rede/trust no clone, recuperação de SSE e consultas desnecessárias em operações administrativas. A revisão também verificou que o cache novo invalida credenciais e que os SQLs dinâmicos usam apenas placeholders para valores.

A jornada de navegador foi ampliada para executar TOTP, login com recovery code e reset, backup real pelo painel, preservação de formulário durante poll, download de logs e resposta atrasada ao alternar aba. Foram mantidas as verificações de XSS, escopos e limites da primeira passagem.

## 8. Verificações finais

| Verificação | Resultado |
| --- | --- |
| `make build` | Painel e agent compilados para Linux amd64 v1 |
| Cross-compilação | Painel e agent estáticos para Linux arm64 e amd64 v3; somente amd64 executado neste ambiente |
| Instalação/start reutilizáveis | Script completo reexecutado com sucesso; painel iniciado e seis smoke checks aprovados |
| `CGO_ENABLED=0 go test -json -count=1 -timeout=120s ./...` | 108 resultados de teste aprovados, zero falhas e zero testes pulados; oito packages não possuem testes |
| `make lint` | gofmt, vet normal/integration, golangci-lint com zero issues e ShellCheck aprovados |
| `make check-generated` | Protobuf/Connect/vtprotobuf e sqlc reproduzíveis em scratch, sem reescrever o checkout |
| `npm run check` | Sintaxe do JavaScript aprovada; projeto não usa TypeScript |
| Chromium + Playwright | Um cenário E2E aprovado, sem skips, cobrindo os fluxos descritos e WebAuthn virtual |
| `CGO_ENABLED=1 go test -race -count=1 -timeout=180s ./...` | Aprovado após as revisões, sem races reportadas; goleak permanece ativo |
| `make test-integration` | Aprovado com Docker/BuildKit/Caddy reais, hardening, tráfego/swap, healthcheck negativo preservando versão anterior, métricas, instaladores Debian/Ubuntu e Minisign oficial |
| Govulncheck v1.9.0 | Zero vulnerabilidades em símbolos chamados e pacotes importados; um aviso de módulo não importado |
| `npm audit --json` | Zero advisories |
| Benchmarks existentes | Hub, ring, logstore, vault e fila executados; números acima |

O endpoint `vuln.go.dev` é bloqueado na rede atual. A análise usou os arquivos OSV do repositório oficial `golang/vulndb`, snapshot `d5e0cfac5d260523df858cd4c0f849e248468fb6`, via `govulncheck -db file:///workspace/.nelcota-cloud/vulndb/data/osv`. O aviso restante é GO-2026-5932, sobre `golang.org/x/crypto/openpgp`: sem correção disponível e sem pacote importado/caminho de chamada neste projeto. Não foi descrito como “zero avisos”.

Logs locais de evidência ficam em `.local/`: `tests-final.jsonl`, `browser-final.log`, `race-final.log`, `integration-final.log`, `vulnerability-final.log`, `npm-audit.json` e relatórios das duas revisões. Esses arquivos e dados de teste não entram no Git. O workflow de CI foi atualizado, mas não foi executado no GitHub nesta sessão.

## 9. Pendências reais e limites

- Homologar instalação root, systemd, firewall IPv4/IPv6, WireGuard, SSH, reboot, crash/disco cheio e restore em VPS descartáveis. Esta máquina não representa esse ambiente e não recebeu mudanças de firewall/SSH.
- Publicar e validar releases com domínio/identidade e chave confiável do mantenedor. Sem publicação ou modificação de produção nesta execução.
- GitHub App/webhook público e bucket S3 reais exigem credenciais e destinos do operador. Há cobertura local de protocolos/criptografia e transporte controlado, sem alegação de integração com contas reais.
- Validar passkeys em dispositivos físicos e outros navegadores, além do Chromium com dispositivo virtual efetivamente testado.
- Metas de memória/latência/instalação em VPS e garantia de zero downtime sob toda carga continuam dependendo de medições representativas; o teste local de swap não prova todos os cenários de tráfego longo.
- Logs SSE permanecem efêmeros, sem replay durável garantido; buffers podem perder eventos sob saturação e snapshots podem se sobrepor a eventos vivos. Essa limitação foi preservada e documentada, em vez de prometer entrega exatamente uma vez.
- Admin/member continuam com escopo global da instalação, sem ACL por app/equipe. Auditoria não é imune a root alterando o arquivo SQLite. A CA interna ainda exige migração de confiança antes de expirar.
- Previews por PR, notificações externas, scale-to-zero, Trivy, Litestream e geração automática de Dockerfile são fase 2 explícita das decisões existentes; não foram apresentados como funcionalidades concluídas da v1.

Não há pendência local conhecida que bloqueie o fluxo v1 validado. Limites externos acima impedem classificar o projeto como 100% homologado para produção.

## Ambiente na nuvem

Scripts de instalação e instruções de inicialização foram testados e salvos no rascunho do ambiente. O painel de desenvolvimento está disponível em `http://localhost:8080`. O salvamento do rascunho não publica a configuração: sua ativação para tarefas futuras exige revisar/salvar as alterações nas configurações e publicar o ambiente. Nenhum segredo foi adicionado.
