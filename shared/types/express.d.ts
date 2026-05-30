declare module 'express' {
  export interface Request {
    user?: import('../../backend/auth/policies').AuthenticatedUser;
    body?: unknown;
    params: Record<string, string | undefined>;
    query?: Record<string, unknown>;
    headers?: Record<string, string | string[] | undefined>;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export interface Response {
    headersSent?: boolean;
    status(code: number): this;
    json(body: unknown): this;
    setHeader(name: string, value: string): this;
    write(chunk: string): boolean;
  }

  export interface NextFunction {
    (error?: unknown): void;
  }

  export interface Handler {
    (req: Request, res: Response, next: NextFunction): unknown;
  }

  export interface ErrorHandler {
    (error: unknown, req: Request, res: Response, next: NextFunction): unknown;
  }

  export interface Router {
    use(...handlers: Array<Handler | ErrorHandler | Router | string>): this;
    get(path: string, ...handlers: Handler[]): this;
    post(path: string, ...handlers: Handler[]): this;
    patch(path: string, ...handlers: Handler[]): this;
    put(path: string, ...handlers: Handler[]): this;
    delete(path: string, ...handlers: Handler[]): this;
  }

  export interface Application extends Router {
    disable(setting: string): this;
    listen(port: number, host: string, callback?: () => void): unknown;
  }

  export interface ExpressFactory {
    (): Application;
    Router(): Router;
    json(options?: Record<string, unknown>): Handler;
  }

  const express: ExpressFactory;
  export default express;
}
