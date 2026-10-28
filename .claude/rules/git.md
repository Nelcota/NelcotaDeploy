# Git

Estas regras complementam o `CLAUDE.md` e têm a mesma prioridade.

- Mensagens de commit sempre em inglês, no formato Conventional Commits: `<type>(<scope>): <description>`.
  - Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `style`, `build`, `ci`, `revert`.
  - Scope: o package afetado (ex: `feat(orders): add pix payment strategy`).
  - Descrição no imperativo, em minúsculas, sem ponto final, com até ~72 caracteres.
  - Use o corpo do commit para explicar o porquê quando não for óbvio.
  - Mudanças incompatíveis: `feat(orders)!: ...` e `BREAKING CHANGE:` no rodapé.
- Commits pequenos e focados: uma mudança lógica por commit. Não misture refactor com feature.
- Os git hooks (Lefthook) formatam, verificam o código e validam a mensagem de commit automaticamente. Nunca use `--no-verify` nem desative os hooks para conseguir commitar. Se um hook falhar, corrija o problema.
- Nunca commite segredos, `.env`, arquivos gerados ou `node_modules`.
- Nunca faça `git push`, force push, rebase de branch compartilhada ou altere histórico já publicado sem eu pedir explicitamente.
- Não faça commit sem eu pedir, a menos que eu tenha autorizado commits nesta tarefa.
- Nomes de branch em inglês e kebab-case, com prefixo do tipo: `feat/pix-payment`, `fix/discount-rounding`.
