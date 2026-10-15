# Operação do backend

## Memória

Em 2026-10-15, o mesmo cenário local (login dev, três apps, nove leituras de logs e oito leituras concorrentes da API, com pprof/flight recorder ativo) passou de 119,2 MiB RSS aquecido / 115,6 MiB após GC para 49,8 MiB / 50,5 MiB. O perfil mostrou aproximadamente 100 MiB de alocações na inicialização, sobretudo no compilador WASM do SQLite, mas apenas 9,4 MiB de heap vivo. `store.Open` devolve as páginas temporárias uma única vez após a primeira inicialização; nenhuma coleta forçada ocorre no caminho de consultas. Os perfis estão em `.local/profiles/` e não devem ser publicados com dados reais.

Diagnóstico local explícito: `nelcota-panel dev --pprof-listen 127.0.0.1:6069 --wg-interface lo`. Em produção, mantenha o listener no WireGuard. A medição local não substitui RAM do agent nem carga representativa na VPS.

## Backup e restore

A inicialização cria `backup.key` (32 bytes, modo 0600), independente de `master.key`. Guarde uma cópia fora do servidor e do bucket. Essa chave não entra no arquivo de backup. O backup contém um `VACUUM INTO` consistente do SQLite e os arquivos regulares do diretório de configuração; logs e imagens Docker ficam fora. O formato `.nbk` usa chave derivada por arquivo, AES-256-GCM em blocos limitados e um marcador final autenticado. Truncamento, reordenação e alteração falham antes de modificar o destino.

```bash
nelcota-panel backup --output /caminho/novo.nbk
nelcota-panel backup --output /caminho/novo.nbk --s3-config /etc/nelcota/backup-s3.json
# Pare o painel antes de substituir uma instalação existente.
nelcota-panel restore /caminho/novo.nbk --key-file /copia-separada/backup.key --replace
```

O restore aceita destinos vazios sem `--replace`, valida a integridade SQLite e preserva cópias `.before-restore` quando substitui. Um lock de processo impede restore com o painel ativo. Um marcador durável impede iniciar após interrupção no meio da substituição; repita o restore com o mesmo backup para concluir. Após restaurar, ajuste o proprietário dos arquivos para o usuário do serviço antes de iniciar. Os arquivos são restaurados como 0600; remova as cópias anteriores apenas depois da verificação.

Em produção, o worker cria um backup por dia UTC em `data-dir/backups`, mantém sete dias locais e tenta novamente a cada hora se houver falha. Upload só é marcado concluído após resposta 2xx. Configure `NELCOTA_BACKUP_KEY_FILE` para guardar a chave fora de `config-dir`, e `NELCOTA_BACKUP_S3_CONFIG` para habilitar envio S3. Configure a retenção remota no bucket.

Exemplo de configuração S3, arquivo 0600 (nenhum desses valores é devolvido pela API):

```json
{"endpoint":"https://s3.exemplo.com","region":"us-east-1","bucket":"nelcota-backups","prefix":"producao","access_key":"...","secret_key":"..."}
```

São suportados `PutObject` em path style, HTTPS, payload assinado e token de sessão opcional. Redirecionamentos são recusados. O signer tem teste contra o [vetor oficial de Signature V4 da AWS](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html); upload TLS, erro e redirecionamento são testados localmente. Aceitação com credenciais reais de R2/Backblaze/MinIO continua externa.
