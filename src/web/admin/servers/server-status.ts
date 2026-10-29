/** Fields of a server that decide how its state is shown. */
type ServerState = {
  readonly status: "pending" | "ready" | "unreachable";
  readonly statusMessage: string | null;
  readonly kind: "local" | "ssh";
};

type Tone = "success" | "danger" | "progress" | "warning";

// The worker records reasons in English for the logs; the panel shows them in Portuguese.
const PROBLEM_MESSAGES: readonly (readonly [RegExp, string])[] = [
  [
    /Host key of .* changed/,
    "A chave SSH do servidor mudou. Se ele foi reinstalado, remova e adicione de novo.",
  ],
  [
    /authentication methods failed/,
    "O painel ainda não tem acesso. Rode o comando de instalação no servidor.",
  ],
  [
    /cannot open tunnels/,
    "O SSH não permite túneis para o painel. Rode o comando de instalação de novo.",
  ],
  [/Docker is not running/, "O Docker não está rodando ou o usuário não está no grupo docker."],
  [
    /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|Timed out|timed out/,
    "Não foi possível conectar. Confira o IP, a porta SSH e o firewall.",
  ],
];

/**
 * Turns the reason a server is not ready into a message for the panel.
 *
 * @param message - Reason recorded by the worker, or null.
 * @returns Text in Portuguese, or null when there is nothing to explain.
 */
export function describeServerProblem(message: string | null): string | null {
  if (message == null || message.trim() === "") {
    return null;
  }
  const known = PROBLEM_MESSAGES.find(([pattern]) => pattern.test(message));
  return known?.[1] ?? "Não foi possível preparar o servidor. Veja os logs do worker.";
}

/**
 * Chooses the status pill of a server.
 *
 * @param server - Status and kind.
 * @returns Tone and label.
 */
export function serverStatusPill(server: ServerState): { tone: Tone; label: string } {
  switch (server.status) {
    case "ready":
      return { tone: "success", label: "Conectado" };
    case "pending":
      return server.kind === "local"
        ? { tone: "progress", label: "Verificando" }
        : { tone: "warning", label: "Aguardando instalação" };
    case "unreachable":
      return { tone: server.kind === "local" ? "danger" : "warning", label: "Inacessível" };
  }
}

/**
 * Tells whether any server is still being set up, so the list refreshes faster.
 *
 * @param servers - Listed servers.
 * @returns True while one of them is not ready.
 */
export function hasServerInProgress(servers: readonly ServerState[]): boolean {
  return servers.some((server) => server.status !== "ready");
}
