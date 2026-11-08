/** Saved variables and the two explicit import workflows, shared by navigation and search. */
export const ENVIRONMENT_SECTIONS = [
  { to: "/projects/$projectId/environment", label: "Variáveis de ambiente", permission: null },
  {
    to: "/projects/$projectId/environment/import",
    label: "Importar variáveis de arquivo .env",
    permission: "environment:write",
  },
  {
    to: "/projects/$projectId/environment/repository",
    label: "Importar variáveis do repositório",
    permission: "environment:write",
  },
] as const;
