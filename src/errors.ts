/**
 * Application error with an optional actionable hint that is printed together with the error message
 */
export class AppError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'AppError';
    this.hint = hint;
  }
}
