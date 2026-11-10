// An error with an HTTP status, thrown by route handlers and helpers.
export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
