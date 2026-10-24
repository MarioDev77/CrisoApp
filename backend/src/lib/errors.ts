export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export const bad = (m: string, extra?: Record<string, unknown>) => new HttpError(400, m, extra);
export const unauthorized = (m = "Não autenticado") => new HttpError(401, m);
export const forbidden = (m = "Acesso negado") => new HttpError(403, m);
export const notFound = (m = "Não encontrado") => new HttpError(404, m);
