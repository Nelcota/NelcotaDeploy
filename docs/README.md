# Documentação do Nelcota Deploy

O backend está implementado e testado localmente. O frontend e a homologação completa em VPS continuam pendentes. Para uma visão rápida, comece pelo [README principal](../README.md).

## Por onde começar

| Objetivo | Documento |
| --- | --- |
| Entender a arquitetura e a visão do produto | [Plano original](Nelcota%20Deploy.md) |
| Conferir o que está implementado e foi validado | [Relatório do backend](relatorio-backend.md) |
| Identificar pendências e validações externas | [Pendências](pendencias.md) |
| Construir a interface ou integrar as APIs | [Contrato do frontend](contrato-frontend.md) |
| Testar instalação e operação em duas VPS | [Roteiro de homologação](testar-em-vps.md) |
| Operar backup, restore, update e recuperação | [Guia de operação](operacao-backend.md) |
| Entender os pacotes locais de laboratório | [Releases de homologação](releases-homologacao.md) |
| Consultar decisões e evolução do backend | [Decisões](decisoes.md) · [Progresso](progresso-backend.md) |
| Enviar uma contribuição ou relatar uma vulnerabilidade | [Contribuição](../CONTRIBUTING.md) · [Segurança](../SECURITY.md) |

## Como interpretar os documentos

O plano original descreve objetivos e possibilidades futuras. O relatório distingue implementação, teste local e aceitação em infraestrutura real. Checkmarks de progresso não substituem a homologação operacional.

Os relatórios de 15/10/2026 preservam as condições da execução local, incluindo caminhos e artefatos daquela máquina. Diretórios `.local/`, `.tools/`, `bin/` e `dist/` não fazem parte do checkout público. A publicação do código não equivale à publicação dos pacotes locais ou à aprovação para produção.

## Identidade visual

O [logo vetorial](assets/logo.svg), o [banner do README](assets/readme-banner.svg) e a [imagem de compartilhamento](assets/social-preview.png) fazem parte do repositório e seguem a licença MIT do projeto. Os SVGs são editáveis e independem de fontes externas ou scripts.
