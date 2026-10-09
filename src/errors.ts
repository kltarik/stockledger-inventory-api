// A business error the API answers with: { code, message, details }.
export class AppError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string, details: Record<string, unknown> = {}) =>
  new AppError(404, 'NOT_FOUND', `${what} not found.`, details);

// PostgreSQL error codes we turn into API answers.
export const isUniqueViolation = (err: unknown, constraint: string) =>
  (err as { code?: string; constraint?: string }).code === '23505' &&
  (err as { constraint?: string }).constraint === constraint;
