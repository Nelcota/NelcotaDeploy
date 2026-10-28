# Sanitização

Estas regras complementam o `CLAUDE.md` e têm a mesma prioridade.

- Valide na entrada, escape na saída. Não tente "limpar" dados removendo caracteres perigosos.
- Valide todo dado que vem de fora (requisições, arquivos, parâmetros de URL) na entrada do sistema. Prefira rejeitar dados inválidos a tentar corrigi-los.
- Normalize na entrada: trim em strings, e-mails em minúsculas, Unicode com `.normalize("NFC")`.
- Limite o tamanho de toda entrada externa (strings, arrays, uploads, corpo de requisições).
- HTML: nunca insira dados do usuário com innerHTML ou concatenação. Use `Bun.escapeHTML` ou um template que escape automaticamente.
- SQL: sempre queries parametrizadas. Nunca concatene strings.
- Shell: use `Bun.$` com interpolação, que escapa os valores automaticamente. Nunca monte comandos concatenando strings.
- Caminhos de arquivo: resolva o caminho e confirme que ele continua dentro do diretório permitido (evita path traversal com `../`).
- URLs vindas do usuário: aceite apenas `http:` e `https:`.
- Objetos vindos de JSON: valide a estrutura antes de usar e nunca faça merge direto em outros objetos (evita prototype pollution com `__proto__`).
- Logs: remova quebras de linha de dados do usuário antes de logar.
