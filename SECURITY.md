# Política de segurança

## Estado de suporte

O Nelcota Deploy ainda está em desenvolvimento e não tem uma versão homologada para produção. Correções são aplicadas à branch `main`. Os números v1.0.0–v1.0.2 documentados no laboratório representam pacotes locais de teste de atualização, não uma linha estável com suporte.

## Relatar uma vulnerabilidade

Use o [relato privado de vulnerabilidade no GitHub](https://github.com/Nelcota/nelcota-deploy/security/advisories/new). Inclua:

- Commit ou versão afetada e ambiente usado.
- Passos para reproduzir e impacto observado.
- Um exemplo mínimo, com credenciais e dados reais removidos.
- Uma sugestão de correção, se disponível.

Evite publicar detalhes exploráveis em issues públicas antes da avaliação e da correção. O projeto não estabelece SLA nem programa de recompensa.

## Limites operacionais

O agent controla o daemon Docker; comprometimento desse acesso pode comprometer o host. Guarde separadamente as chaves de backup, assinatura e criptografia. A política de rede, o isolamento, os instaladores e a recuperação precisam ser homologados no ambiente de destino.

Consulte o [guia de operação](docs/operacao-backend.md), os [limites da validação](docs/relatorio-backend.md#pontos-para-revisão-de-segurança) e o [roteiro de VPS](docs/testar-em-vps.md).
