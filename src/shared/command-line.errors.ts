/** Thrown when a command line has unbalanced quotes or a dangling escape. */
export class CommandLineParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandLineParseError";
  }
}
