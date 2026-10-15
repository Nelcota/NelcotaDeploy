# Operação do backend

## Memória

Em 2026-10-15, o mesmo cenário local (login dev, três apps, nove leituras de logs e oito leituras concorrentes da API, com pprof/flight recorder ativo) passou de 119,2 MiB RSS aquecido / 115,6 MiB após GC para 49,8 MiB / 50,5 MiB. O perfil mostrou aproximadamente 100 MiB de alocações na inicialização, sobretudo no compilador WASM do SQLite, mas apenas 9,4 MiB de heap vivo. `store.Open` devolve as páginas temporárias uma única vez após a primeira inicialização; nenhuma coleta forçada ocorre no caminho de consultas. Os perfis estão em `.local/profiles/` e não devem ser publicados com dados reais.

Diagnóstico local explícito: `nelcota-panel dev --pprof-listen 127.0.0.1:6069 --wg-interface lo`. Em produção, mantenha o listener no WireGuard. O agent real foi medido com Docker/BuildKit, mTLS e duas coletas de métricas: 32 MiB inicialmente, 27,3 MiB após startup/GC ajustados e 24,6–25,0 MiB com `GODEBUG=disablethp=1`. Os serviços configuram essa opção para evitar desperdício de THP em heaps pequenos; o host de teste usa THP always. O agent usa GOGC=50 por padrão e respeita GOGC explícito. O painel ficou em 46,7–53,5 MiB após backup completo pela API, com diagnóstico ativo. A medição local não substitui homologar a carga e o hardware da VPS. Consulte o [guia Go sobre Linux/THP](https://go.dev/doc/gc-guide#Linux).

## Backup e restore

A inicialização cria `backup.key` (32 bytes, modo 0600), independente de `master.key`. Guarde uma cópia fora do servidor e do bucket. Essa chave não entra no arquivo de backup. O backup contém um `VACUUM INTO` consistente do SQLite e os arquivos regulares do diretório de configuração; logs e imagens Docker ficam fora. O formato `.nbk` usa chave derivada por arquivo, AES-256-GCM em blocos limitados e um marcador final autenticado. Truncamento, reordenação e alteração falham antes de modificar o destino.

```bash
nelcota-panel backup --output /caminho/novo.nbk
nelcota-panel backup --output /caminho/novo.nbk --s3-config /etc/nelcota/backup-s3.json
# Pare o painel antes de substituir uma instalação existente.
nelcota-panel restore /caminho/novo.nbk --key-file /copia-separada/backup.key --replace
```

O restore aceita destinos vazios sem `--replace`, valida a integridade SQLite e preserva cópias `.before-restore` quando substitui. Um lock de processo impede restore com o painel ativo. Um marcador durável impede iniciar após interrupção no meio da substituição; repita o restore com o mesmo backup para concluir. O restore preserva o proprietário do diretório de destino quando executado como root numa instalação existente. Numa máquina nova, confira proprietários e endereços antes de iniciar. Ele recria backup.key a partir da cópia fornecida pelo operador, para que um novo backup funcione após restaurar; essa chave não vem do tar. Os arquivos são restaurados como 0600; remova as cópias anteriores apenas depois da verificação.

Em produção, o worker cria um backup por dia UTC em `data-dir/backups`, mantém sete dias locais e tenta novamente a cada hora se houver falha. Upload só é marcado concluído após resposta 2xx. Configure `NELCOTA_BACKUP_KEY_FILE` para guardar a chave fora de `config-dir`, e `NELCOTA_BACKUP_S3_CONFIG` para habilitar envio S3. Configure a retenção remota no bucket. Também é possível enviar a configuração JSON para `PUT /api/settings/backup.s3` no campo value (string JSON); credenciais ficam cifradas no SQLite e Get devolve apenas a presença da chave. O arquivo configurado por ambiente tem precedência; mudanças em settings passam a valer no próximo upload.

Exemplo de configuração S3, arquivo 0600 (nenhum desses valores é devolvido pela API):

```json
{"endpoint":"https://s3.exemplo.com","region":"us-east-1","bucket":"nelcota-backups","prefix":"producao","access_key":"...","secret_key":"..."}
```

São suportados `PutObject` em path style, HTTPS, payload assinado e token de sessão opcional. Redirecionamentos são recusados. O signer tem teste contra o [vetor oficial de Signature V4 da AWS](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html); upload TLS, erro e redirecionamento são testados localmente. Aceitação com credenciais reais de R2/Backblaze/MinIO continua externa.

## Atualização assinada e desinstalação

`nelcota-panel update v1.2.3` e `nelcota-agent update v1.2.3` escrevem uma solicitação para o daemon. O painel usa a mesma fila coordenada da API; o agent reserva manutenção no painel por mTLS antes de acionar o helper. Ambos aguardam os builds ativos. O instalador configura `/etc/nelcota-release-{panel,agent}.json`, protegido e pertencente a root, com a URL base, chave Minisign e arquitetura escolhida. A URL de instalação termina em uma versão imutável (`https://releases.exemplo.com/v1.2.3`). O helper aceita somente versões estáveis posteriores à instalada, verifica o formato prehashed ED do [Minisign](https://jedisct1.github.io/minisign/), inclusive o comentário assinado, e confere os hashes do metadata e do executável. O serviço não fornece caminhos ou comandos ao helper.

O binário novo é gravado e sincronizado ao lado do instalado, depois substituído por rename. A cópia `.previous` permite voltar automaticamente se o serviço não permanecer ativo; o painel também deve responder ao healthcheck local. O agent deve emitir heartbeat pronto com o PID/versão atuais; o helper verifica esse estado antes de confirmar o update. A fila só avança depois da confirmação e da prontidão. Estado da versão aplicada é protegido em `/var/lib/nelcota-updater/`. Uma queda de energia deixa um executável completo e a cópia anterior para reparo. Os helpers não atualizam Docker, Caddy ou BuildKit; esses daemons têm ciclos de distribuição próprios.

A API usa `POST /api/operations/update` com `{"version":"v1.2.3"}`: verifica o release antes de criar uma fila durável, aguarda os deploys ativos terminarem, atualiza os agents em ordem e espera o heartbeat com a versão nova. O painel vem por último. Uma falha interrompe o lote. Um server offline mantém a fila aguardando; é possível cancelar um lote que ainda não começou. Enquanto uma etapa está em execução, novos builds no respectivo destino aguardam. `GET /api/operations` mostra estados e códigos públicos; `POST /api/operations/{batch}/cancel` cancela etapas ainda na fila.

`POST /api/operations/backup` também cria um job durável. Operações de manutenção exigem administrador com autenticação interativa nos últimos cinco minutos. Tokens de API não podem solicitar backup, atualização ou cancelamento. Snapshots manuais são conservados até remoção administrativa; a retenção automática de sete dias é dos backups diários.

Empacotamento sem publicação: `scripts/release.sh v1.2.3 CHAVE_MINISIGN BUILDKITD_AMD64 BUILDKITD_ARM64`. Inclui versão nos executáveis, `release.json` e checksums assinados. A identidade e os releases oficiais ainda precisam ser configurados pelo mantenedor.

`nelcota-panel uninstall` / `nelcota-agent uninstall` exigem root, param e removem os serviços e executáveis Nelcota. Os dados são mantidos. `--purge` remove também os diretórios padrão de dados, chaves e estado do updater. Docker, Caddy, WireGuard, firewall, hardening SSH e containers das aplicações permanecem para migração ou remoção explícita. A operação não remove recursos compartilhados do host.

## Recuperação de TOTP

Depois de configurar TOTP, `POST /api/auth/recovery-codes` em uma sessão interativa recente gera dez códigos aleatórios de 160 bits, mostrados somente nessa resposta. O banco guarda hashes, e gerar novamente invalida todos os anteriores. Se perder o autenticador, conclua a cerimônia de passkey e envie o desafio de segundo fator e um código para `POST /api/auth/recovery/verify`. Cada código é consumido de forma atômica e serve uma vez, inclusive sob concorrência.

`POST /api/auth/totp/reset` exige autenticação interativa recente e revoga TOTP, códigos, desafios, sessões e tokens de API do usuário. A passkey permanece; entre novamente e configure o segundo fator. Recuperação local sem os códigos: pare o painel e execute `nelcota-panel reset-totp --email usuario@exemplo.com` com acesso ao diretório privado. Essa operação é auditada e usa o mesmo lock que impede manutenção offline com o painel ativo.

Para instalações anteriores sem chave de backup: `nelcota-panel backup-keygen --output /local-separado/backup.key` cria uma chave sem sobrescrever arquivos e sem imprimi-la. Configure `NELCOTA_BACKUP_KEY_FILE` no serviço.

## Jobs e diagnóstico

`PATCH /api/servers/{id}/limits` recebe build_limit (1–8) e cache_bytes (64 MiB–100 GiB). A alteração é auditada e o valor chega pelo snapshot periódico, sem interromper builds já ativos. O teto de cache é usado no próximo GC; a ação Prune permite limpeza imediata. Servers incluem version e ready; novas claims aguardam prontidão após reconexão.

Métricas do agent incluem CPU por delta, memória sem cache inativo, limite, rede e PIDs dos containers Nelcota. A coleta tem orçamento de dez segundos, quatro chamadas concorrentes e limite de 256 containers por amostra; não bloqueia o heartbeat. Disco usa o data-dir real do agent.

O parser Dockerfile registra bases com ARGs default, ignora estágios locais, scratch e digest pins. O job consulta tags semanalmente e materializa camadas no content store do BuildKit (não no cache separado do Docker). Há timeout e nova tentativa horária em falha. Builds também pedem resolução atualizada; apps existentes não são redeployadas pelo job.

Com diagnóstico privado habilitado, deploy acima de dois minutos gera um trace automaticamente. Há limite de um por hora e retenção de cinco arquivos privados em data-dir/traces. Sem diagnóstico, o flight recorder não fica ativo e não consome o buffer. O snapshot manual permanece disponível na interface de diagnóstico.

Convites de instalação do agent só são aceitos por arquivo 0600 (`--join-file` no instalador, `--join-token-file` no binário); o token não é recebido por argumento de processo.
