# Segurança

Estas regras complementam o `CLAUDE.md` e têm a mesma prioridade.

## Autenticação

- Senhas: sempre `Bun.password.hash` e `Bun.password.verify`. Nunca use MD5/SHA para senhas.
- Nunca implemente criptografia própria. Use as APIs nativas (`crypto.subtle`) ou bibliotecas consolidadas.
- Tokens e IDs secretos: use `crypto.randomUUID` ou `crypto.getRandomValues`. Nunca `Math.random`.
- Compare tokens e assinaturas com `crypto.timingSafeEqual` (após confirmar que têm o mesmo tamanho), nunca com `===`.
- Mensagens de login genéricas ("usuário ou senha inválidos"), sem revelar qual dos dois está errado.
- Aplique rate limiting em login, cadastro e recuperação de senha.

## Sessões e cookies (quando houver autenticação)

- Cookies de sessão com httpOnly, secure e sameSite.
- Tokens com expiração curta. Se usar JWT, valide sempre a assinatura e o algoritmo, e nunca aceite "none".

## Autorização

- Verifique permissão em toda requisição, no servidor. Nunca confie no frontend.
- Ao acessar um recurso por ID, confirme que ele pertence ao usuário autenticado.
- Princípio do menor privilégio: cada parte do sistema acessa só o que precisa.

## Segredos e configuração

- Segredos só em variáveis de ambiente, nunca no código nem em logs. Garanta que `.env` está no `.gitignore`.
- Valide as variáveis de ambiente obrigatórias na inicialização e falhe cedo se faltar alguma.

## Respostas HTTP (quando houver servidor)

- Em produção, nunca retorne stack traces ou mensagens internas ao cliente. Logue o detalhe, responda com erro genérico.
- Configure headers de segurança (Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options).
- CORS restrito às origens necessárias. Nunca use `*` junto com credenciais.
