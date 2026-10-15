# Pendências e validações externas

## Implementação local concluída em 2026-10-15

- Memória investigada com perfis: liberação única do espaço temporário do compilador SQLite e do startup do agent; GOGC=50 no agent (respeita override) e THP desabilitado apenas nos processos dos serviços.
- Backup diário e manual, snapshot WAL consistente, criptografia independente, retenção local e S3; restore offline com lock, autenticação completa, verificação da master key e proteção contra interrupção.
- Atualização assinada por CLI/API, helper fixo do systemd, fila durável de agents um por vez e painel por último, verificação de prontidão/confirmação e volta ao executável anterior em falha; uninstall mantém dados por padrão.
- Renovação automática dos certificados, grace/retry de fingerprint e reposição dos peers WireGuard pelo banco.
- Recovery codes e reset de TOTP, limites/cache editáveis pela API, métricas por container, atualização semanal das bases no BuildKit e captura automática de trace de deploy lento (quando diagnóstico está habilitado).

O [guia de operação](operacao-backend.md) documenta comandos, formatos, configuração e limites. O [contrato do frontend](contrato-frontend.md) inclui as rotas novas. Não há pendência de implementação local nessa lista.

## Aceitação que exige infraestrutura ou credenciais

- Executar instalação, update/rollback e reboot em VPS Debian/Ubuntu descartável com systemd, firewall IPv4/IPv6, WireGuard, cgroups e SSH reais. Sintaxe dos instaladores e lógica do helper foram testadas localmente; não houve instalação root no host de trabalho.
- Escolher repositório/domínio e identidade do mantenedor, publicar releases oficiais assinados e distribuir a chave pública. Nenhum release foi publicado nesta sessão.
- Configurar GitHub App real, webhook público e credenciais de S3 de produção. API GitHub usa transporte simulado nos testes; upload S3 tem TLS real local, teste de redirecionamento e vetor oficial SigV4. Minisign produzido pelo utilitário oficial em Debian foi verificado pela implementação Go.
- Validar passkeys em browsers/dispositivos reais; o fluxo foi testado com autenticador virtual ECDSA.
- Provar todas as metas em VPS representativa, com builds Go/Node, carga longa, streaming, crash, disco cheio e reboot. Docker/BuildKit/Caddy locais passaram sob tráfego. Memória local final e condições estão no relatório; isso não é homologação da VPS.
- Exercitar recuperação completa numa VPS nova, incluindo reconfigurar a interface WireGuard com a chave protegida do backup e ajustar domínio/endereço e donos dos arquivos ao destino.

## Fora da fase atual

Previews, notificações externas, scale-to-zero, Trivy e Litestream continuam na fase 2. PGO permanece em auto, sem perfil artificial; coletar perfil representativo de produção antes de versionar default.pgo. A CA interna de cinco anos exige renovação/migração de confiança antes do vencimento; a rotação automática implementada cobre os certificados de serviço de três meses.

Govulncheck v1.9.0: zero vulnerabilidades em símbolos chamados e pacotes importados. Permanece um aviso de módulo requerido para OpenPGP não importado (GO-2026-5932). Manter o scanner no CI e verificar separadamente as versões dos daemons distribuídos.
