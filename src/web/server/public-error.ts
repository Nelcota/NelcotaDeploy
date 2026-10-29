import { AlertDeliveryError } from "@/alerts";
import {
  ForbiddenError,
  InvalidAvatarError,
  SetupAlreadyDoneError,
  UnauthenticatedError,
  UserOperationError,
} from "@/auth";
import { InvalidConfigError } from "@/config";
import { GitHubApiError } from "@/github";
import {
  NoServerAvailableError,
  ServerInUseError,
  ServerNotFoundError,
  ServerNotReadyError,
  ServerTakenError,
} from "@/servers";

import { PROJECT_ERROR_MESSAGES } from "./project-error-messages";

const GENERIC_MESSAGE = "Ocorreu um erro inesperado. Tente novamente em instantes.";

type ErrorClass = abstract new (...args: never[]) => Error;

const MESSAGES: readonly (readonly [ErrorClass, string])[] = [
  [UnauthenticatedError, "Sua sessão expirou. Entre novamente."],
  [ForbiddenError, "Você não tem permissão para esta ação."],
  [GitHubApiError, "Não foi possível falar com o GitHub. Tente novamente em instantes."],
  [SetupAlreadyDoneError, "O painel já tem um administrador. Entre com a sua conta."],
  [InvalidAvatarError, "Imagem inválida. Use uma foto PNG, JPEG ou WebP de até 512 KB."],
  [AlertDeliveryError, "O webhook de alertas não aceitou a mensagem. Confira a URL."],
  [ServerNotFoundError, "Servidor não encontrado."],
  [ServerTakenError, "Já existe um servidor com este nome ou endereço."],
  [ServerNotReadyError, "Este servidor ainda não está conectado. Escolha um servidor pronto."],
  [
    ServerInUseError,
    "Este servidor não pode ser removido: ainda há projetos nele ou ele é o servidor do painel.",
  ],
  [
    NoServerAvailableError,
    "Nenhum servidor aceita novas aplicações. Ative um em Administração → Servidores.",
  ],
  ...PROJECT_ERROR_MESSAGES,
];

const USER_OPERATION_MESSAGES: Readonly<Record<string, string>> = {
  "Email already in use": "Este e-mail já está em uso.",
  "At least one active admin must remain": "É preciso manter pelo menos um administrador ativo.",
};

/** Error whose message is safe and meant to be shown to the user. */
export class PublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicError";
  }
}

function hasValidationIssues(error: unknown): error is { issues: { message: string }[] } {
  if (typeof error !== "object" || error == null || "issues" in error === false) {
    return false;
  }
  return Array.isArray(error.issues);
}

/**
 * Converts any error thrown by a server function into a message in Portuguese that is safe
 * to show. Unknown errors become a generic message so internals never reach the browser.
 *
 * @param error - Thrown value.
 * @returns The public error, or null for unknown errors that must be logged.
 */
export function toPublicError(error: unknown): PublicError | null {
  if (error instanceof PublicError) {
    return error;
  }
  for (const [errorClass, message] of MESSAGES) {
    if (error instanceof errorClass) {
      return new PublicError(message);
    }
  }
  if (error instanceof UserOperationError) {
    const translated = USER_OPERATION_MESSAGES[error.message];
    return new PublicError(translated ?? "A senha precisa ter pelo menos 12 caracteres.");
  }
  if (error instanceof InvalidConfigError) {
    return new PublicError(
      "O servidor está com a configuração incompleta. Verifique as variáveis de ambiente.",
    );
  }
  if (hasValidationIssues(error)) {
    const first = error.issues[0]?.message ?? "verifique os campos";
    return new PublicError(`Dados inválidos: ${first}`);
  }
  return null;
}

/** Message shown for errors that are not explicitly translated. */
export const GENERIC_ERROR_MESSAGE = GENERIC_MESSAGE;
